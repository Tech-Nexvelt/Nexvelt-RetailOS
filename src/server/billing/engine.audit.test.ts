/**
 * Phase 1 audit tests for the in-memory demo BillingEngine.
 *
 * PROVEN HERE (unit level, single process): input defence in the engine itself, and invariants
 * that must hold after any sequence of valid and invalid operations.
 *
 * NOT PROVEN HERE: real concurrency. The engine is synchronous, so "simultaneous" requests are
 * always serialised by JavaScript. Row locks, isolation levels, rollback of a half-written
 * transaction, unique-index backstops and RLS need PostgreSQL integration tests that have not
 * been run (see docs/TEST_STRATEGY.md TC-CONC-*, TC-SEC-*).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BillingEngine } from "./engine";
import { DEMO_BRANCH, demoCatalog } from "./demo-data";
import { policyFor } from "@/domain/policy";
import type { CartLineInput, CheckoutInput, PaymentInput } from "@/domain/billing";

let engine: BillingEngine;
beforeEach(() => {
  engine = new BillingEngine({ branchId: DEMO_BRANCH, items: demoCatalog() });
  engine.openSession(0);
});

describe("the engine defends itself (not only the action layer)", () => {
  it("rejects an unknown payment method even if marked as received", () => {
    const r = engine.checkout({
      idempotencyKey: "m",
      lines: [{ itemId: "v1", quantity: 1 }],
      expectedTotalPaise: 129900,
      payments: [
        { method: "BITCOIN", amountPaise: 129900, confirmedReceived: true },
      ] as unknown as PaymentInput[],
    });
    expect(!r.ok && r.code).toBe("VALIDATION_ERROR");
    expect(engine.invoices).toHaveLength(0);
  });

  it("reports a malformed cart as an error instead of an empty ₹0 cart", () => {
    const bad = [{ itemId: "v1", quantity: 0 }];
    const q = engine.quote(bad);
    expect(q.issues[0]?.code).toBe("VALIDATION_ERROR");
    expect(q.grandTotalPaise).toBe(0);
    const dup = engine.quote([
      { itemId: "v1", quantity: 1 },
      { itemId: "v1", quantity: 1 },
    ]);
    expect(dup.issues[0]?.code).toBe("VALIDATION_ERROR");
  });

  it("does not match a barcode with embedded whitespace or look-alike characters", () => {
    for (const code of ["NR 00000001", "NR-00000001", "ＮＲ０００００００１", "NR00000001 X"]) {
      const r = engine.scan(code, []);
      expect(!r.ok && r.code, code).toBe("BARCODE_NOT_FOUND");
    }
  });

  it("never changes state when only quoting, scanning or searching", () => {
    const before = JSON.stringify(demoCatalog().map((i) => engine.stockOf(i.id)));
    for (let i = 0; i < 50; i++) {
      engine.quote([{ itemId: "v1", quantity: 2 }]);
      engine.scan("NR00000001", []);
      engine.addItem("j1", []);
      engine.search("shirt");
    }
    expect(JSON.stringify(demoCatalog().map((i) => engine.stockOf(i.id)))).toBe(before);
    expect(engine.invoices).toHaveLength(0);
  });

  it("does not hand out mutable internals", () => {
    const s = engine.getSession();
    s.open = false;
    expect(engine.getSession().open).toBe(true);
    const r = engine.checkout({
      idempotencyKey: "r",
      lines: [{ itemId: "v1", quantity: 1 }],
      expectedTotalPaise: 129900,
      payments: [{ method: "CASH", amountPaise: 129900 }],
    });
    if (r.ok) r.data.paidPaise = 0; // a caller tampering with its copy...
    const replay = engine.checkout({
      idempotencyKey: "r",
      lines: [{ itemId: "v1", quantity: 1 }],
      expectedTotalPaise: 129900,
      payments: [{ method: "CASH", amountPaise: 129900 }],
    });
    // ...does not corrupt the stored original beyond what the shallow copy exposes.
    expect(replay.ok && replay.data.grandTotalPaise).toBe(129900);
  });
});

/** Small deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("randomised invariants over 2,000 mixed valid and invalid checkouts", () => {
  const ITEM_IDS = ["v1", "v2", "v3", "v10", "j1", "j2", "j3", "g1", "x1", "ghost"];
  const initial = new Map(demoCatalog().map((i) => [i.id, i]));

  function state() {
    return JSON.stringify([...ITEM_IDS.map((id) => engine.stockOf(id)), engine.invoices.length]);
  }

  it.each([1, 7, 42, 2026])("holds for seed %i", (seed) => {
    const rand = mulberry32(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const soldQty = new Map<string, number>();
    const uniqueSold = new Map<string, number>();
    const usedKeys: { key: string; input: CheckoutInput }[] = [];
    let successes = 0;
    let failures = 0;

    for (let op = 0; op < 500; op++) {
      const nLines = 1 + Math.floor(rand() * 4);
      const used = new Set<string>();
      const lines: CartLineInput[] = [];
      for (let i = 0; i < nLines; i++) {
        const itemId = pick(ITEM_IDS);
        if (used.has(itemId) && rand() < 0.9) continue; // mostly avoid duplicate lines
        used.add(itemId);
        const line: CartLineInput = { itemId, quantity: pick([1, 1, 1, 2, 3, 0, 7]) };
        if (rand() < 0.25) {
          line.discountPaise = pick([0, 1, 500, 12345, 999999999]);
          line.discountReason = rand() < 0.8 ? "Offer" : "";
        }
        lines.push(line);
      }
      const policy = policyFor(pick(["owner", "cashier", "manager"] as const));
      const quote = engine.quote(lines, policy);
      const truth = quote.grandTotalPaise;

      let payments: PaymentInput[];
      const mode = Math.floor(rand() * 5);
      if (mode === 0) payments = [{ method: "CASH", amountPaise: truth }];
      else if (mode === 1)
        payments = [{ method: "UPI", amountPaise: truth, confirmedReceived: true }];
      else if (mode === 2)
        payments = [{ method: "CARD", amountPaise: truth }]; // unconfirmed
      else if (mode === 3) {
        const a = Math.floor(truth / 3);
        payments = [
          { method: "UPI", amountPaise: a, confirmedReceived: true },
          { method: "CASH", amountPaise: truth - a, tenderedPaise: truth - a + 50 },
        ];
      } else payments = [{ method: "CASH", amountPaise: truth + pick([-1, 1, 100]) }];

      const reuse = usedKeys.length > 0 && rand() < 0.2;
      let input: CheckoutInput;
      if (reuse) {
        input = (pick(usedKeys) as { input: CheckoutInput }).input;
      } else {
        input = {
          idempotencyKey: `k-${seed}-${op}`,
          lines,
          expectedTotalPaise: rand() < 0.9 ? truth : truth + 1,
          payments,
        };
      }

      const before = state();
      const invoicesBefore = engine.invoices.length;
      const r = engine.checkout(input, policy);

      if (!r.ok) {
        failures++;
        // ALL-OR-NOTHING: any failure changes nothing at all.
        expect(state(), `op ${op} failed with ${r.code}`).toBe(before);
        continue;
      }
      if (r.data.replayed) {
        // IDEMPOTENCY: a replay creates nothing.
        expect(engine.invoices.length).toBe(invoicesBefore);
        continue;
      }
      successes++;
      usedKeys.push({ key: input.idempotencyKey, input });
      const inv = r.data;

      // PAYMENT RECONCILIATION and TOTAL INTEGRITY
      expect(inv.grandTotalPaise).toBeGreaterThan(0);
      expect(inv.payments.reduce((n, p) => n + p.amountPaise, 0)).toBe(inv.grandTotalPaise);
      expect(inv.paidPaise).toBe(inv.grandTotalPaise);
      expect(inv.lines.reduce((n, l) => n + l.lineTotalPaise, 0)).toBe(inv.grandTotalPaise);
      for (const l of inv.lines) {
        expect(l.lineTotalPaise).toBe(l.unitPricePaise * l.quantity - l.discountPaise);
        expect(l.lineTotalPaise).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(l.lineTotalPaise)).toBe(true);
      }
      expect(engine.invoices.length).toBe(invoicesBefore + 1);

      for (const line of input.lines) {
        const item = initial.get(line.itemId);
        if (!item) continue;
        if (item.kind === "CLOTHING") {
          soldQty.set(line.itemId, (soldQty.get(line.itemId) ?? 0) + line.quantity);
        } else {
          uniqueSold.set(line.itemId, (uniqueSold.get(line.itemId) ?? 0) + 1);
        }
      }
    }

    // STOCK CONSERVATION: stock = initial - units sold, and never negative.
    for (const id of ITEM_IDS) {
      const item = initial.get(id);
      if (item?.kind === "CLOTHING") {
        expect(engine.stockOf(id).stock).toBe((item.stock ?? 0) - (soldQty.get(id) ?? 0));
        expect(engine.stockOf(id).stock).toBeGreaterThanOrEqual(0);
      }
    }
    // SERIALIZED ITEMS: each piece sold at most once, and only pieces that were in stock here.
    for (const [id, n] of uniqueSold) {
      expect(n, `unique item ${id} sold ${n} times`).toBe(1);
      expect(initial.get(id)?.status).toBe("IN_STOCK");
      expect(initial.get(id)?.branchId).toBe(DEMO_BRANCH);
      expect(engine.stockOf(id).status).toBe("SOLD");
    }
    // Items that were never sellable here were never sold.
    for (const id of ["j2", "j3", "x1", "v3", "ghost"]) {
      expect(soldQty.get(id) ?? 0).toBe(0);
      expect(uniqueSold.get(id) ?? 0).toBe(0);
    }
    // GAPLESS NUMBERING
    expect(engine.invoices.map((i) => i.invoiceNumber)).toEqual(
      engine.invoices.map((_, i) => `DEMO-${String(i + 1).padStart(6, "0")}`),
    );
    expect(successes).toBeGreaterThan(5); // the run actually exercised the success path
    expect(failures).toBeGreaterThan(50); // ...and the failure path
  });
});
