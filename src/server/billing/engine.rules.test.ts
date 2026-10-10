/**
 * UNIT tests of the in-memory demo BillingEngine (Phase 1).
 *
 * These prove the business rules in application code. They do NOT prove database behaviour:
 * the engine is single-threaded and has no real transactions, so "two cashiers at once" here is
 * only a sequential simulation. Real concurrency, locking, rollback and RLS must be verified by
 * PostgreSQL integration tests (docs/TEST_STRATEGY.md, TC-CONC-*), which need a running database
 * and are NOT yet executed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BillingEngine, type CatalogRecord } from "./engine";
import { DEMO_BRANCH, demoCatalog } from "./demo-data";
import { BILLING_ERRORS } from "@/domain/errors";
import { policyFor } from "@/domain/policy";
import type { BillingErrorCode, CartLineInput, CheckoutInput } from "@/domain/billing";

const OWNER = policyFor("owner");
const CASHIER = policyFor("cashier");
const SHIRT = "v1"; // ₹1,299.00, stock 5
const NECKLACE = "j1"; // ₹499.00, unique

let engine: BillingEngine;

beforeEach(() => {
  engine = new BillingEngine({ branchId: DEMO_BRANCH, items: demoCatalog() });
  engine.openSession(0);
});

function pay(total: number): CheckoutInput["payments"] {
  return [{ method: "CASH", amountPaise: total }];
}

function bill(
  key: string,
  lines: CartLineInput[],
  policy = CASHIER,
  overrides: Partial<CheckoutInput> = {},
) {
  const total = engine.quote(lines, policy).grandTotalPaise;
  return engine.checkout(
    { idempotencyKey: key, lines, expectedTotalPaise: total, payments: pay(total), ...overrides },
    policy,
  );
}

function snapshot() {
  return {
    shirt: engine.stockOf(SHIRT).stock,
    necklace: engine.stockOf(NECKLACE).status,
    chain: engine.stockOf("g1").status,
    invoices: engine.invoices.length,
  };
}

describe("unknown and inactive products", () => {
  const items: CatalogRecord[] = [
    ...demoCatalog(),
    {
      id: "off1",
      kind: "CLOTHING",
      code: "NR00000777",
      name: "Discontinued Kurta",
      detail: "M / Red",
      unitPricePaise: 99900,
      branchId: DEMO_BRANCH,
      active: false,
      stock: 10,
      searchText: "discontinued kurta m red",
    },
  ];

  beforeEach(() => {
    engine = new BillingEngine({ branchId: DEMO_BRANCH, items });
    engine.openSession(0);
  });

  it("reports an unknown barcode as not found", () => {
    const r = engine.scan("ZZ99999999", []);
    expect(!r.ok && r.code).toBe("BARCODE_NOT_FOUND");
  });

  it("refuses to scan or add an inactive product", () => {
    const scan = engine.scan("NR00000777", []);
    expect(!scan.ok && scan.code).toBe("ITEM_INACTIVE");
    const add = engine.addItem("off1", []);
    expect(!add.ok && add.code).toBe("ITEM_INACTIVE");
  });

  it("hides inactive products from name search", () => {
    expect(engine.search("kurta")).toEqual([]);
  });

  it("rejects an unknown item id at checkout and changes nothing", () => {
    const before = snapshot();
    const r = engine.checkout({
      idempotencyKey: "u1",
      lines: [{ itemId: "does-not-exist", quantity: 1 }],
      expectedTotalPaise: 0,
      payments: pay(0),
    });
    expect(!r.ok && r.code).toBe("ITEM_NOT_FOUND");
    expect(snapshot()).toEqual(before);
  });

  it("rejects an inactive item that was added to a cart before it was switched off", () => {
    const r = engine.checkout({
      idempotencyKey: "u2",
      lines: [{ itemId: "off1", quantity: 1 }],
      expectedTotalPaise: 99900,
      payments: pay(99900),
    });
    expect(!r.ok && r.code).toBe("ITEM_INACTIVE");
    expect(engine.invoices).toHaveLength(0);
  });
});

describe("quantity and price validation", () => {
  it("rejects bad quantities at checkout", () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, 1000, Number.POSITIVE_INFINITY]) {
      const r = engine.checkout({
        idempotencyKey: `q-${String(quantity)}`,
        lines: [{ itemId: SHIRT, quantity }],
        expectedTotalPaise: 0,
        payments: pay(0),
      });
      expect(r.ok, `quantity ${String(quantity)}`).toBe(false);
    }
    expect(engine.invoices).toHaveLength(0);
    expect(engine.stockOf(SHIRT).stock).toBe(5);
  });

  it("rejects a quantity above 1 for a unique jewellery piece", () => {
    const r = bill("u", [{ itemId: NECKLACE, quantity: 2 }]);
    expect(!r.ok && r.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a quantity above stock", () => {
    const r = bill("s", [{ itemId: SHIRT, quantity: 6 }]);
    expect(!r.ok && r.code).toBe("INSUFFICIENT_STOCK");
  });

  it("always prices from the server catalogue, never from the request", () => {
    // The request type has no price field. Even a tampered object cannot change the price,
    // because the engine only reads itemId, quantity and the discount fields.
    const tampered = [
      { itemId: SHIRT, quantity: 1, unitPricePaise: 1 },
    ] as unknown as CartLineInput[];
    expect(engine.quote(tampered).grandTotalPaise).toBe(129900);
  });

  it("rejects a total the client computed from a stale or altered price", () => {
    const r = engine.checkout({
      idempotencyKey: "p",
      lines: [{ itemId: SHIRT, quantity: 1 }],
      expectedTotalPaise: 1,
      payments: pay(1),
    });
    expect(!r.ok && r.code).toBe("PRICE_STALE");
    expect(engine.invoices).toHaveLength(0);
  });
});

describe("cart totals and discount validation", () => {
  it("totals several lines exactly", () => {
    const q = engine.quote([
      { itemId: SHIRT, quantity: 3 },
      { itemId: NECKLACE, quantity: 1 },
      { itemId: "g1", quantity: 1 },
    ]);
    expect(q.grandTotalPaise).toBe(129900 * 3 + 49900 + 4850000);
    expect(q.discountTotalPaise).toBe(0);
    expect(q.itemCount).toBe(5);
    expect(q.issues).toEqual([]);
  });

  it("applies an authorised discount and totals it exactly", () => {
    const q = engine.quote(
      [{ itemId: SHIRT, quantity: 2, discountPaise: 25980, discountReason: "Festival offer" }],
      OWNER,
    );
    expect(q.lines[0]?.grossPaise).toBe(259800);
    expect(q.lines[0]?.discountPaise).toBe(25980);
    expect(q.discountTotalPaise).toBe(25980);
    expect(q.grandTotalPaise).toBe(233820);
    expect(q.issues).toEqual([]);
  });

  it("refuses any discount from a cashier or manager (limit not yet decided, OQ-21)", () => {
    for (const role of ["cashier", "manager"] as const) {
      const q = engine.quote(
        [{ itemId: SHIRT, quantity: 1, discountPaise: 1, discountReason: "Regular customer" }],
        policyFor(role),
      );
      expect(q.issues[0]?.code, role).toBe("DISCOUNT_NOT_ALLOWED");
    }
  });

  it("requires a reason for every discount, even an authorised one", () => {
    const q = engine.quote([{ itemId: SHIRT, quantity: 1, discountPaise: 1000 }], OWNER);
    expect(q.issues[0]?.code).toBe("DISCOUNT_REASON_REQUIRED");
    const blank = engine.quote(
      [{ itemId: SHIRT, quantity: 1, discountPaise: 1000, discountReason: "   " }],
      OWNER,
    );
    expect(blank.issues[0]?.code).toBe("DISCOUNT_REASON_REQUIRED");
  });

  it("refuses a discount larger than the line, even for the owner", () => {
    const q = engine.quote(
      [{ itemId: SHIRT, quantity: 1, discountPaise: 129901, discountReason: "x" }],
      OWNER,
    );
    expect(q.issues[0]?.code).toBe("DISCOUNT_NOT_ALLOWED");
  });

  it("enforces a partial limit exactly (no rounding loophole)", () => {
    const limited = { maxDiscountBps: 1000 }; // 10%
    const ok = engine.quote(
      [{ itemId: SHIRT, quantity: 1, discountPaise: 12990, discountReason: "Offer" }],
      limited,
    );
    expect(ok.issues).toEqual([]);
    const over = engine.quote(
      [{ itemId: SHIRT, quantity: 1, discountPaise: 12991, discountReason: "Offer" }],
      limited,
    );
    expect(over.issues[0]?.code).toBe("DISCOUNT_NOT_ALLOWED");
  });

  it("rejects negative or fractional discounts as malformed", () => {
    for (const discountPaise of [-1, 0.5]) {
      const r = bill(
        "d",
        [{ itemId: SHIRT, quantity: 1, discountPaise, discountReason: "x" }],
        OWNER,
      );
      expect(r.ok, String(discountPaise)).toBe(false);
    }
  });

  it("blocks checkout of an unauthorised discount and leaves everything untouched", () => {
    const before = snapshot();
    const lines = [{ itemId: SHIRT, quantity: 1, discountPaise: 5000, discountReason: "Friend" }];
    const r = engine.checkout(
      {
        idempotencyKey: "disc",
        lines,
        expectedTotalPaise: 124900,
        payments: pay(124900),
      },
      CASHIER,
    );
    expect(!r.ok && r.code).toBe("DISCOUNT_NOT_ALLOWED");
    expect(snapshot()).toEqual(before);
  });

  it("completes a discounted bill for an authorised actor and records the discount", () => {
    const lines = [{ itemId: SHIRT, quantity: 1, discountPaise: 5000, discountReason: "Offer" }];
    const r = bill("disc-ok", lines, OWNER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.grandTotalPaise).toBe(124900);
      expect(r.data.lines[0]?.discountPaise).toBe(5000);
    }
  });

  it("keeps a discount when more of the same item is scanned", () => {
    const first = engine.scan("NR00000001", [], OWNER);
    expect(first.ok).toBe(true);
    const withDiscount = [
      { itemId: SHIRT, quantity: 1, discountPaise: 1000, discountReason: "Offer" },
    ];
    const again = engine.scan("NR00000001", withDiscount, OWNER);
    expect(again.ok && again.data.lines[0]?.quantity).toBe(2);
    expect(again.ok && again.data.lines[0]?.discountPaise).toBe(1000);
  });
});

describe("payments", () => {
  it("rejects zero, negative and fractional payment amounts", () => {
    for (const amountPaise of [0, -100, 0.5]) {
      const r = engine.checkout({
        idempotencyKey: `pa-${amountPaise}`,
        lines: [{ itemId: SHIRT, quantity: 1 }],
        expectedTotalPaise: 129900,
        payments: [{ method: "CASH", amountPaise }],
      });
      expect(r.ok, String(amountPaise)).toBe(false);
    }
    expect(engine.invoices).toHaveLength(0);
  });

  it("rejects an overpayment as well as an underpayment", () => {
    for (const amountPaise of [129899, 129901]) {
      const r = engine.checkout({
        idempotencyKey: `pm-${amountPaise}`,
        lines: [{ itemId: SHIRT, quantity: 1 }],
        expectedTotalPaise: 129900,
        payments: [{ method: "CASH", amountPaise }],
      });
      expect(!r.ok && r.code).toBe("PAYMENT_MISMATCH");
    }
  });

  it("rejects a bill with no payment", () => {
    const r = engine.checkout({
      idempotencyKey: "np",
      lines: [{ itemId: SHIRT, quantity: 1 }],
      expectedTotalPaise: 129900,
      payments: [],
    });
    expect(!r.ok && r.code).toBe("PAYMENT_MISMATCH");
  });

  it("supports a three-way split and adds change only for cash", () => {
    const lines = [{ itemId: "g1", quantity: 1 }]; // 4,850,000
    const r = engine.checkout({
      idempotencyKey: "split3",
      lines,
      expectedTotalPaise: 4850000,
      payments: [
        { method: "UPI", amountPaise: 2000000, confirmedReceived: true, reference: "UPI123" },
        { method: "CARD", amountPaise: 2000000, confirmedReceived: true },
        { method: "CASH", amountPaise: 850000, tenderedPaise: 900000 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.paidPaise).toBe(4850000);
      expect(r.data.changePaise).toBe(50000);
    }
  });

  it("does not let one unconfirmed non-cash row slip through a split", () => {
    const r = engine.checkout({
      idempotencyKey: "split-unconfirmed",
      lines: [{ itemId: SHIRT, quantity: 1 }],
      expectedTotalPaise: 129900,
      payments: [
        { method: "UPI", amountPaise: 100000, confirmedReceived: true },
        { method: "CARD", amountPaise: 29900 }, // not confirmed
      ],
    });
    expect(!r.ok && r.code).toBe("PAYMENT_NOT_CONFIRMED");
    expect(engine.invoices).toHaveLength(0);
  });
});

describe("serialized items (sequential simulation only)", () => {
  it("never sells the same piece twice", () => {
    expect(bill("a", [{ itemId: NECKLACE, quantity: 1 }]).ok).toBe(true);
    const second = bill("b", [{ itemId: NECKLACE, quantity: 1 }]);
    expect(!second.ok && second.code).toBe("ITEM_ALREADY_SOLD");
    expect(engine.invoices).toHaveLength(1);
  });

  it("cannot be re-added to a cart after it is sold", () => {
    bill("a", [{ itemId: NECKLACE, quantity: 1 }]);
    const r = engine.scan("IJ0000123", []);
    expect(!r.ok && r.code).toBe("ITEM_ALREADY_SOLD");
  });
});

describe("idempotency and duplicate submission", () => {
  it("replays an identical request exactly, including a second 'double click'", () => {
    const lines = [{ itemId: SHIRT, quantity: 2 }];
    const a = bill("same", lines);
    const b = bill("same", lines);
    const c = bill("same", lines);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(b.data.invoiceId).toBe(a.data.invoiceId);
      expect(c.data.invoiceNumber).toBe(a.data.invoiceNumber);
      expect([a.data.replayed, b.data.replayed, c.data.replayed]).toEqual([false, true, true]);
    }
    expect(engine.invoices).toHaveLength(1);
    expect(engine.stockOf(SHIRT).stock).toBe(3);
  });

  it("treats line order as irrelevant when matching a replay", () => {
    const first = bill("order", [
      { itemId: SHIRT, quantity: 1 },
      { itemId: NECKLACE, quantity: 1 },
    ]);
    const swapped = engine.checkout({
      idempotencyKey: "order",
      lines: [
        { itemId: NECKLACE, quantity: 1 },
        { itemId: SHIRT, quantity: 1 },
      ],
      expectedTotalPaise: 129900 + 49900,
      payments: pay(129900 + 49900),
    });
    expect(first.ok && swapped.ok && swapped.data.replayed).toBe(true);
    expect(engine.invoices).toHaveLength(1);
  });

  it("refuses to reuse a key for a different payload, including a different payment", () => {
    bill("k", [{ itemId: SHIRT, quantity: 1 }]);
    const sameCartOtherPayment = engine.checkout({
      idempotencyKey: "k",
      lines: [{ itemId: SHIRT, quantity: 1 }],
      expectedTotalPaise: 129900,
      payments: [{ method: "UPI", amountPaise: 129900, confirmedReceived: true }],
    });
    expect(!sameCartOtherPayment.ok && sameCartOtherPayment.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(engine.invoices).toHaveLength(1);
  });

  it("allows a retry with the same key after a failure, then dedupes the success", () => {
    const lines = [{ itemId: SHIRT, quantity: 1 }];
    const bad = engine.checkout({
      idempotencyKey: "retry",
      lines,
      expectedTotalPaise: 129900,
      payments: [{ method: "UPI", amountPaise: 129900 }], // unconfirmed
    });
    expect(bad.ok).toBe(false);
    const good = engine.checkout({
      idempotencyKey: "retry",
      lines,
      expectedTotalPaise: 129900,
      payments: [{ method: "UPI", amountPaise: 129900, confirmedReceived: true }],
    });
    expect(good.ok).toBe(true);
    expect(engine.invoices).toHaveLength(1);
  });

  it("numbers invoices consecutively with no gaps, even across failures", () => {
    bill("n1", [{ itemId: SHIRT, quantity: 1 }]);
    bill("fail", [{ itemId: "missing", quantity: 1 }]);
    bill("n2", [{ itemId: SHIRT, quantity: 1 }]);
    expect(engine.invoices.map((i) => i.invoiceNumber)).toEqual(["DEMO-000001", "DEMO-000002"]);
  });
});

describe("all-or-nothing checkout", () => {
  const cart: CartLineInput[] = [
    { itemId: SHIRT, quantity: 2 },
    { itemId: NECKLACE, quantity: 1 },
    { itemId: "g1", quantity: 1 },
  ];

  it("changes nothing when one item of many is unavailable", () => {
    bill("sell-chain", [{ itemId: "g1", quantity: 1 }]); // someone else buys the chain first
    const before = snapshot();
    const r = bill("multi", cart);
    expect(!r.ok && r.code).toBe("ITEM_ALREADY_SOLD");
    expect(snapshot()).toEqual(before);
    expect(engine.stockOf(SHIRT).stock).toBe(5); // the valid shirt lines were not decremented
    expect(engine.stockOf(NECKLACE).status).toBe("IN_STOCK");
  });

  it("changes nothing when payment validation fails after items validate", () => {
    const before = snapshot();
    const total = engine.quote(cart).grandTotalPaise;
    const r = engine.checkout({
      idempotencyKey: "pay-fail",
      lines: cart,
      expectedTotalPaise: total,
      payments: [{ method: "CASH", amountPaise: total - 1 }],
    });
    expect(!r.ok && r.code).toBe("PAYMENT_MISMATCH");
    expect(snapshot()).toEqual(before);
  });

  it("changes nothing when the day has not been started", () => {
    const fresh = new BillingEngine({ branchId: DEMO_BRANCH, items: demoCatalog() });
    const r = fresh.checkout({
      idempotencyKey: "closed",
      lines: cart,
      expectedTotalPaise: 0,
      payments: pay(0),
    });
    expect(!r.ok && r.code).toBe("SESSION_NOT_OPEN");
    expect(fresh.invoices).toHaveLength(0);
    expect(fresh.stockOf(SHIRT).stock).toBe(5);
  });

  it("commits every effect together on success", () => {
    const r = bill("all", cart);
    expect(r.ok).toBe(true);
    expect(snapshot()).toEqual({ shirt: 3, necklace: "SOLD", chain: "SOLD", invoices: 1 });
  });
});

describe("error messages are clear and actionable", () => {
  it("returns a code that has a plain-language message for every failure path", () => {
    const codes = new Set<BillingErrorCode>();
    const collect = (r: { ok: boolean; code?: BillingErrorCode }) => {
      if (!r.ok && r.code) codes.add(r.code);
    };
    collect(engine.scan("NOPE0000", []));
    collect(engine.scan("IJ0000124", []));
    collect(engine.scan("IJ0000125", []));
    collect(engine.scan("IJ0000999", []));
    collect(engine.scan("NR00000003", []));
    collect(engine.scan("IJ0000123", [{ itemId: NECKLACE, quantity: 1 }]));
    collect(bill("e1", [{ itemId: SHIRT, quantity: 1, discountPaise: 5, discountReason: "x" }]));
    collect(bill("e2", [{ itemId: "ghost", quantity: 1 }]));
    collect(bill("e3", []));
    expect(codes.size).toBeGreaterThanOrEqual(8);
    for (const code of codes) {
      expect(BILLING_ERRORS[code], code).toBeDefined();
    }
  });

  it("writes messages for cashiers: no jargon, no raw codes, and a next step", () => {
    for (const [code, e] of Object.entries(BILLING_ERRORS)) {
      const text = `${e.title} ${e.fix}`;
      expect(text, code).not.toMatch(
        /undefined|null|exception|stack|sql|rpc|\b[A-Z]{2,}_[A-Z_]+\b/i,
      );
      expect(e.title.endsWith("."), `${code} title`).toBe(true);
      expect(e.fix.endsWith("."), `${code} fix`).toBe(true);
      expect(e.fix.length, `${code} fix length`).toBeGreaterThan(12);
    }
  });
});
