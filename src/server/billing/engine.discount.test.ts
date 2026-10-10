/**
 * UNIT tests for discount boundaries and discount x payment interactions on the in-memory demo
 * engine. See engine.rules.test.ts for the scope note: these do not prove database behaviour.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BillingEngine } from "./engine";
import { DEMO_BRANCH, demoCatalog } from "./demo-data";
import { policyFor, type ActorPolicy } from "@/domain/policy";
import type { CartLineInput, CheckoutInput } from "@/domain/billing";

const OWNER = policyFor("owner");
const CASHIER = policyFor("cashier");
const SHIRT = "v1"; // ₹1,299.00 = 129900 paise
const GROSS = 129900;

let engine: BillingEngine;
beforeEach(() => {
  engine = new BillingEngine({ branchId: DEMO_BRANCH, items: demoCatalog() });
  engine.openSession(0);
});

const line = (discountPaise?: number, quantity = 1, reason = "Offer"): CartLineInput => ({
  itemId: SHIRT,
  quantity,
  ...(discountPaise === undefined ? {} : { discountPaise, discountReason: reason }),
});

function checkout(
  key: string,
  lines: CartLineInput[],
  policy: ActorPolicy,
  payments: (total: number) => CheckoutInput["payments"],
) {
  const total = engine.quote(lines, policy).grandTotalPaise;
  return engine.checkout(
    { idempotencyKey: key, lines, expectedTotalPaise: total, payments: payments(total) },
    policy,
  );
}

describe("default deny", () => {
  it("denies discounts when no policy is supplied at all", () => {
    const q = engine.quote([line(1)]);
    expect(q.issues[0]?.code).toBe("DISCOUNT_NOT_ALLOWED");
    const r = engine.checkout({
      idempotencyKey: "nopolicy",
      lines: [line(1)],
      expectedTotalPaise: GROSS - 1,
      payments: [{ method: "CASH", amountPaise: GROSS - 1 }],
    });
    expect(!r.ok && r.code).toBe("DISCOUNT_NOT_ALLOWED");
  });

  it("denies discounts for an explicit zero-authority policy", () => {
    expect(engine.quote([line(1)], { maxDiscountBps: 0 }).issues[0]?.code).toBe(
      "DISCOUNT_NOT_ALLOWED",
    );
  });

  it("still sells at full price without a discount for a user with no discount authority", () => {
    const r = checkout("full", [line()], CASHIER, (t) => [{ method: "CASH", amountPaise: t }]);
    expect(r.ok && r.data.grandTotalPaise).toBe(GROSS);
  });

  it("ignores a discount reason when there is no discount", () => {
    const q = engine.quote([{ itemId: SHIRT, quantity: 1, discountReason: "none" }], CASHIER);
    expect(q.issues).toEqual([]);
    expect(q.lines[0]?.discountPaise).toBe(0);
  });
});

describe("invalid discount values", () => {
  it("rejects negative, fractional, NaN, infinite and unsafe discounts as malformed", () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      const r = checkout(`bad-${String(bad)}`, [line(bad)], OWNER, (t) => [
        { method: "CASH", amountPaise: Math.max(t, 1) },
      ]);
      expect(r.ok, String(bad)).toBe(false);
    }
    expect(engine.invoices).toHaveLength(0);
  });

  it("can never produce a negative line total or a negative invoice", () => {
    for (const d of [GROSS + 1, GROSS * 2, 10 ** 9]) {
      const q = engine.quote([line(d)], OWNER);
      expect(q.issues[0]?.code, String(d)).toBe("DISCOUNT_NOT_ALLOWED");
      for (const l of q.lines) expect(l.lineTotalPaise).toBeGreaterThanOrEqual(0);
      expect(q.grandTotalPaise).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("boundaries", () => {
  it("accepts a discount of exactly 1 paise and refuses 0 paise as 'no discount'", () => {
    expect(engine.quote([line(1)], OWNER).issues).toEqual([]);
    const zero = engine.quote([line(0)], OWNER);
    expect(zero.discountTotalPaise).toBe(0);
    expect(zero.issues).toEqual([]);
  });

  it("accepts a discount of gross minus 1 paise (₹0.01 left) for the owner", () => {
    const r = checkout("edge", [line(GROSS - 1)], OWNER, (t) => [
      { method: "CASH", amountPaise: t },
    ]);
    expect(r.ok && r.data.grandTotalPaise).toBe(1);
  });

  it("refuses a 100% discount that would leave a zero-value bill", () => {
    const q = engine.quote([line(GROSS)], OWNER);
    expect(q.grandTotalPaise).toBe(0);
    const r = engine.checkout(
      {
        idempotencyKey: "free",
        lines: [line(GROSS)],
        expectedTotalPaise: 0,
        payments: [{ method: "CASH", amountPaise: 1 }],
      },
      OWNER,
    );
    expect(!r.ok && r.code).toBe("TOTAL_NOT_PAYABLE");
    expect(engine.invoices).toHaveLength(0);
    expect(engine.stockOf(SHIRT).stock).toBe(5);
  });

  it("allows a free line when the rest of the bill is payable", () => {
    const lines: CartLineInput[] = [
      line(GROSS),
      { itemId: "j1", quantity: 1 }, // ₹499 necklace
    ];
    const r = checkout("free-line", lines, OWNER, (t) => [{ method: "CASH", amountPaise: t }]);
    expect(r.ok && r.data.grandTotalPaise).toBe(49900);
  });

  it("applies the percentage limit exactly at, below and above the boundary", () => {
    const five: ActorPolicy = { maxDiscountBps: 500 }; // 5% of 129900 = 6495 exactly
    expect(engine.quote([line(6494)], five).issues).toEqual([]);
    expect(engine.quote([line(6495)], five).issues).toEqual([]);
    expect(engine.quote([line(6496)], five).issues[0]?.code).toBe("DISCOUNT_NOT_ALLOWED");
  });

  it("measures the limit against the line gross (unit price x quantity)", () => {
    const five: ActorPolicy = { maxDiscountBps: 500 };
    expect(engine.quote([line(12990, 2)], five).issues).toEqual([]); // 5% of 259800
    expect(engine.quote([line(12991, 2)], five).issues[0]?.code).toBe("DISCOUNT_NOT_ALLOWED");
  });

  it("limits each line on its own, not as a pooled invoice allowance", () => {
    const five: ActorPolicy = { maxDiscountBps: 500 };
    const lines: CartLineInput[] = [
      line(6495),
      { itemId: "j1", quantity: 1, discountPaise: 2496, discountReason: "Offer" }, // 5% of 49900 = 2495
    ];
    const q = engine.quote(lines, five);
    expect(q.issues.map((i) => i.itemId)).toEqual(["j1"]);
  });
});

describe("discounts and payments together", () => {
  it("requires payments to match the discounted total, not the gross", () => {
    const lines = [line(10000)];
    const gross = engine.checkout(
      {
        idempotencyKey: "pay-gross",
        lines,
        expectedTotalPaise: GROSS - 10000,
        payments: [{ method: "CASH", amountPaise: GROSS }],
      },
      OWNER,
    );
    expect(!gross.ok && gross.code).toBe("PAYMENT_MISMATCH");
    const net = checkout("pay-net", lines, OWNER, (t) => [{ method: "CASH", amountPaise: t }]);
    expect(net.ok && net.data.paidPaise).toBe(GROSS - 10000);
  });

  it("reconciles a split payment to the discounted total, to the paisa", () => {
    const lines = [line(33333)];
    const net = GROSS - 33333; // 96567
    const r = checkout("split", lines, OWNER, () => [
      { method: "UPI", amountPaise: 50000, confirmedReceived: true },
      { method: "CARD", amountPaise: 20000, confirmedReceived: true },
      { method: "CASH", amountPaise: net - 70000, tenderedPaise: 30000 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.grandTotalPaise).toBe(net);
      expect(r.data.paidPaise).toBe(net);
      expect(r.data.payments.reduce((n, p) => n + p.amountPaise, 0)).toBe(net);
      expect(r.data.changePaise).toBe(30000 - (net - 70000));
    }
  });

  it("rejects a split that matches the gross but not the discounted total", () => {
    const r = engine.checkout(
      {
        idempotencyKey: "split-gross",
        lines: [line(10000)],
        expectedTotalPaise: GROSS - 10000,
        payments: [
          { method: "UPI", amountPaise: 100000, confirmedReceived: true },
          { method: "CASH", amountPaise: 29900 },
        ],
      },
      OWNER,
    );
    expect(!r.ok && r.code).toBe("PAYMENT_MISMATCH");
    expect(engine.invoices).toHaveLength(0);
  });

  it("does not record payments or stock when an unauthorised discount fails a split bill", () => {
    const r = engine.checkout(
      {
        idempotencyKey: "split-denied",
        lines: [line(10000)],
        expectedTotalPaise: GROSS - 10000,
        payments: [
          { method: "UPI", amountPaise: 100000, confirmedReceived: true },
          { method: "CASH", amountPaise: GROSS - 10000 - 100000 },
        ],
      },
      CASHIER,
    );
    expect(!r.ok && r.code).toBe("DISCOUNT_NOT_ALLOWED");
    expect(engine.invoices).toHaveLength(0);
    expect(engine.stockOf(SHIRT).stock).toBe(5);
  });

  it("treats a change in discount as a different request for idempotency", () => {
    const a = checkout("same-key", [line(1000)], OWNER, (t) => [
      { method: "CASH", amountPaise: t },
    ]);
    expect(a.ok).toBe(true);
    const b = checkout("same-key", [line(2000)], OWNER, (t) => [
      { method: "CASH", amountPaise: t },
    ]);
    expect(!b.ok && b.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(engine.invoices).toHaveLength(1);
  });

  it("the invoice line total always equals gross minus discount, and lines sum to the total", () => {
    const lines: CartLineInput[] = [
      line(12345, 3),
      { itemId: "j1", quantity: 1, discountPaise: 999, discountReason: "Offer" },
      { itemId: "g1", quantity: 1 },
    ];
    const r = checkout("sum", lines, OWNER, (t) => [{ method: "CASH", amountPaise: t }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const sum = r.data.lines.reduce((n, l) => n + l.lineTotalPaise, 0);
      expect(sum).toBe(r.data.grandTotalPaise);
      for (const l of r.data.lines) {
        expect(l.lineTotalPaise).toBe(l.unitPricePaise * l.quantity - l.discountPaise);
      }
    }
  });
});
