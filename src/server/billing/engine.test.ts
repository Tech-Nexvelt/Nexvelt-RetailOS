import { beforeEach, describe, expect, it } from "vitest";
import { BillingEngine } from "./engine";
import { DEMO_BRANCH, demoCatalog } from "./demo-data";
import type { CartLineInput, CheckoutInput } from "@/domain/billing";

let engine: BillingEngine;

beforeEach(() => {
  engine = new BillingEngine({ branchId: DEMO_BRANCH, items: demoCatalog() });
  engine.openSession(100000);
});

function scanOk(code: string, cart: CartLineInput[]): CartLineInput[] {
  const r = engine.scan(code, cart);
  if (!r.ok) throw new Error(`scan failed: ${r.code}`);
  return r.data.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity }));
}

function cashCheckout(
  key: string,
  cart: CartLineInput[],
  overrides: Partial<CheckoutInput> = {},
): CheckoutInput {
  const total = engine.quote(cart).grandTotalPaise;
  return {
    idempotencyKey: key,
    lines: cart,
    expectedTotalPaise: total,
    payments: [{ method: "CASH", amountPaise: total }],
    ...overrides,
  };
}

describe("barcode scanning", () => {
  it("adds an exact barcode match immediately", () => {
    const r = engine.scan("NR00000001", []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.lines[0]?.itemId).toBe("v1");
  });

  it("normalises case and scanner whitespace but still requires an exact code", () => {
    expect(engine.scan("  nr00000001\r\n", []).ok).toBe(true);
  });

  it("never matches a barcode by prefix or substring", () => {
    for (const partial of ["NR0000000", "NR000000", "0000001", "NR", "IJ00001", "GJ000004"]) {
      const r = engine.scan(partial, []);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("BARCODE_NOT_FOUND");
    }
  });

  it("does not let a shorter code match a longer one (NR00000012 vs NR0000001x)", () => {
    const r = engine.scan("NR0000001", []);
    expect(r.ok).toBe(false);
  });

  it("increments clothing quantity on a repeat scan", () => {
    const cart = scanOk("NR00000001", scanOk("NR00000001", []));
    expect(cart).toEqual([{ itemId: "v1", quantity: 2 }]);
  });

  it("refuses to scan a unique jewellery tag twice", () => {
    const cart = scanOk("IJ0000123", []);
    const r = engine.scan("IJ0000123", cart);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_IN_CART");
  });

  it("gives specific reasons for sold, held, other-branch and out-of-stock items", () => {
    const codeFor = (code: string) => {
      const r = engine.scan(code, []);
      return r.ok ? "OK" : r.code;
    };
    expect(codeFor("IJ0000124")).toBe("ITEM_ALREADY_SOLD");
    expect(codeFor("IJ0000125")).toBe("ITEM_ON_HOLD");
    expect(codeFor("IJ0000999")).toBe("ITEM_NOT_IN_BRANCH");
    expect(codeFor("NR00000003")).toBe("INSUFFICIENT_STOCK");
  });

  it("does not exceed available stock when scanning repeatedly", () => {
    let cart: CartLineInput[] = [];
    for (let i = 0; i < 3; i++) cart = scanOk("NR00000002", cart); // stock 3
    const r = engine.scan("NR00000002", cart);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INSUFFICIENT_STOCK");
  });
});

describe("text search", () => {
  it("finds items by name", () => {
    expect(engine.search("shirt").map((r) => r.itemId)).toContain("v1");
  });

  it("never matches barcodes or tag codes, even partially", () => {
    expect(engine.search("NR0000")).toEqual([]);
    expect(engine.search("IJ0000123")).toEqual([]);
    expect(engine.search("GJ0000")).toEqual([]);
  });

  it("excludes other branches and ignores single-character queries", () => {
    expect(engine.search("bangle")).toEqual([]);
    expect(engine.search("s")).toEqual([]);
  });

  it("flags unavailable items instead of hiding them", () => {
    const sold = engine.search("kundan").find((r) => r.itemId === "j2");
    expect(sold?.available).toBe(false);
  });
});

describe("pricing", () => {
  it("computes totals on the server in whole paise", () => {
    let cart = scanOk("NR00000001", []);
    cart = scanOk("NR00000001", cart);
    cart = scanOk("IJ0000123", cart);
    const q = engine.quote(cart);
    expect(q.grandTotalPaise).toBe(129900 * 2 + 49900);
    expect(q.itemCount).toBe(3);
    expect(q.taxConfigured).toBe(false);
  });
});

describe("checkout", () => {
  it("completes a mixed cart, decrements stock and marks unique pieces sold", () => {
    let cart = scanOk("NR00000001", []);
    cart = scanOk("IJ0000123", cart);
    cart = scanOk("GJ0000045", cart);
    const r = engine.checkout(cashCheckout("k1", cart));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.invoiceNumber).toBe("DEMO-000001");
      expect(r.data.replayed).toBe(false);
    }
    expect(engine.stockOf("v1").stock).toBe(4);
    expect(engine.stockOf("j1").status).toBe("SOLD");
    expect(engine.stockOf("g1").status).toBe("SOLD");
  });

  it("requires the day to be started", () => {
    const fresh = new BillingEngine({ branchId: DEMO_BRANCH, items: demoCatalog() });
    const r = fresh.checkout({
      idempotencyKey: "k",
      lines: [{ itemId: "v1", quantity: 1 }],
      expectedTotalPaise: 129900,
      payments: [{ method: "CASH", amountPaise: 129900 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SESSION_NOT_OPEN");
  });

  it("rejects an empty cart", () => {
    const r = engine.checkout({
      idempotencyKey: "k",
      lines: [],
      expectedTotalPaise: 0,
      payments: [],
    });
    expect(!r.ok && r.code).toBe("CART_EMPTY");
  });

  it("returns the original bill for a duplicate submit and creates no second invoice", () => {
    const cart = scanOk("NR00000001", []);
    const first = engine.checkout(cashCheckout("dup", cart));
    const second = engine.checkout(cashCheckout("dup", cart));
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.invoiceNumber).toBe(first.data.invoiceNumber);
      expect(second.data.replayed).toBe(true);
    }
    expect(engine.invoices).toHaveLength(1);
    expect(engine.stockOf("v1").stock).toBe(4); // decremented once, not twice
  });

  it("rejects a reused key with a different payload", () => {
    const cart = scanOk("NR00000001", []);
    engine.checkout(cashCheckout("same", cart));
    const other = scanOk("IJ0000123", []);
    const r = engine.checkout(cashCheckout("same", other));
    expect(!r.ok && r.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("prevents the same jewellery piece being sold twice (two counters)", () => {
    const cartA = scanOk("IJ0000123", []);
    const cartB = scanOk("IJ0000123", []); // both counters scanned before either paid
    expect(engine.checkout(cashCheckout("a", cartA)).ok).toBe(true);
    const second = engine.checkout({
      idempotencyKey: "b",
      lines: cartB,
      expectedTotalPaise: 49900,
      payments: [{ method: "CASH", amountPaise: 49900 }],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("ITEM_ALREADY_SOLD");
    expect(engine.invoices).toHaveLength(1);
  });

  it("prevents overselling the last unit of a variant", () => {
    const cart: CartLineInput[] = [{ itemId: "v2", quantity: 3 }]; // stock 3
    expect(engine.checkout(cashCheckout("a", cart)).ok).toBe(true);
    const again = engine.checkout(cashCheckout("b", [{ itemId: "v2", quantity: 1 }]));
    expect(!again.ok && again.code).toBe("INSUFFICIENT_STOCK");
    expect(engine.stockOf("v2").stock).toBe(0);
  });

  it("leaves stock and invoices untouched when checkout fails", () => {
    const cart = scanOk("NR00000001", scanOk("IJ0000123", []));
    const bad = cashCheckout("bad", cart, {
      payments: [{ method: "CASH", amountPaise: 1 }],
    });
    const r = engine.checkout(bad);
    expect(!r.ok && r.code).toBe("PAYMENT_MISMATCH");
    expect(engine.invoices).toHaveLength(0);
    expect(engine.stockOf("v1").stock).toBe(5);
    expect(engine.stockOf("j1").status).toBe("IN_STOCK");
    // The same key may be retried after a failure.
    expect(engine.checkout(cashCheckout("bad", cart)).ok).toBe(true);
  });

  it("rejects a total the cashier did not see (price changed)", () => {
    const cart = scanOk("NR00000001", []);
    const r = engine.checkout(cashCheckout("k", cart, { expectedTotalPaise: 100 }));
    expect(!r.ok && r.code).toBe("PRICE_STALE");
  });

  it("calculates change from cash tendered", () => {
    const cart = scanOk("NR00000001", []);
    const r = engine.checkout(
      cashCheckout("k", cart, {
        payments: [{ method: "CASH", amountPaise: 129900, tenderedPaise: 150000 }],
      }),
    );
    expect(r.ok && r.data.changePaise).toBe(20100);
  });

  it("rejects cash tendered below the amount due", () => {
    const cart = scanOk("NR00000001", []);
    const r = engine.checkout(
      cashCheckout("k", cart, {
        payments: [{ method: "CASH", amountPaise: 129900, tenderedPaise: 100000 }],
      }),
    );
    expect(!r.ok && r.code).toBe("CASH_TENDER_TOO_LOW");
  });

  it("never records UPI or card as received without explicit confirmation", () => {
    const cart = scanOk("NR00000001", []);
    for (const method of ["UPI", "CARD"] as const) {
      const r = engine.checkout(
        cashCheckout(`k-${method}`, cart, { payments: [{ method, amountPaise: 129900 }] }),
      );
      expect(!r.ok && r.code).toBe("PAYMENT_NOT_CONFIRMED");
    }
    expect(engine.invoices).toHaveLength(0);
  });

  it("accepts a split payment only when it adds up exactly", () => {
    const cart = scanOk("NR00000001", []); // 129900
    const short = engine.checkout(
      cashCheckout("s1", cart, {
        payments: [
          { method: "UPI", amountPaise: 100000, confirmedReceived: true },
          { method: "CASH", amountPaise: 29000 },
        ],
      }),
    );
    expect(!short.ok && short.code).toBe("PAYMENT_MISMATCH");
    const exact = engine.checkout(
      cashCheckout("s2", cart, {
        payments: [
          { method: "UPI", amountPaise: 100000, confirmedReceived: true },
          { method: "CASH", amountPaise: 29900, tenderedPaise: 30000 },
        ],
      }),
    );
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.data.changePaise).toBe(100);
  });

  it("rejects malformed carts (zero, fractional or duplicate lines)", () => {
    for (const lines of [
      [{ itemId: "v1", quantity: 0 }],
      [{ itemId: "v1", quantity: 1.5 }],
      [
        { itemId: "v1", quantity: 1 },
        { itemId: "v1", quantity: 1 },
      ],
    ]) {
      const r = engine.checkout({
        idempotencyKey: `m-${JSON.stringify(lines)}`,
        lines,
        expectedTotalPaise: 129900,
        payments: [{ method: "CASH", amountPaise: 129900 }],
      });
      expect(r.ok).toBe(false);
    }
  });
});
