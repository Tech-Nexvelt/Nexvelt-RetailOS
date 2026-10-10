/**
 * Transactional checkout, pricing, discounts, tax, idempotency, rollback and immutability.
 * Environment: REAL PostgreSQL 17 (embedded) with a Supabase-compatible auth shim. Not Supabase.
 * Each test builds its own tenant and shop, so tests are independent.
 *
 * The 10% rate used for tax tests is a TEST FIXTURE (see shop.ts). It is not a GST rate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asUser, expectFail, probe, refused, startDb, type TestDb } from "./harness";
import { buildWorld, type World } from "./fixtures";
import { buildShop, cash, checkout, configureTax, quote, rpc, startDay, type Shop } from "./shop";

let db: TestDb;
let c: Client;

beforeAll(async () => {
  db = await startDb();
  c = db.admin;
});
afterAll(async () => {
  await db?.stop();
});

interface Ctx {
  w: World;
  s: Shop;
}
async function setup(
  opts: { tax?: "exclusive" | "inclusive" | "off" | null; start?: boolean } = {},
): Promise<Ctx> {
  const w = await buildWorld(c);
  const s = await buildShop(c, w);
  if (opts.tax !== null) await configureTax(c, w, s, opts.tax ?? "off");
  if (opts.start !== false) {
    const r = await startDay(c, w.cashierA1, w.a1.id, w.a1.counterId);
    expect(r.ok).toBe(true);
  }
  return { w, s };
}

const sell = (
  x: Ctx,
  lines: unknown[],
  payments: unknown[],
  expected: number,
  extra: Record<string, unknown> = {},
) =>
  checkout(c, x.w.cashierA1, {
    branch: x.w.a1.id,
    counter: x.w.a1.counterId,
    lines,
    payments,
    expected,
    ...extra,
  });

async function snap(x: Ctx) {
  const r = await c.query(
    `select (select count(*)::int from retailos.invoices where tenant_id = $1) as invoices,
            (select count(*)::int from retailos.payments where tenant_id = $1) as payments,
            (select count(*)::int from retailos.inventory_movements where tenant_id = $1 and movement_type = 'SALE') as sale_movements,
            (select coalesce(sum(on_hand), 0)::int from retailos.inventory_balances where tenant_id = $1) as stock,
            (select string_agg(status, ',' order by tag_code) from retailos.jewellery_items where tenant_id = $1) as statuses,
            (select coalesce(sum(next_number), 0)::int from retailos.document_sequences where tenant_id = $1) as seq,
            (select count(*)::int from retailos.idempotency_keys where tenant_id = $1 and scope = 'checkout') as keys`,
    [x.w.tenantA],
  );
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------
describe("tax is never invented", () => {
  it("refuses to bill until the owner configures tax (default is blocked, not zero)", async () => {
    const x = await setup({ tax: null });
    const before = await snap(x);
    const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900);
    expect(r).toMatchObject({ ok: false, code: "TAX_NOT_CONFIGURED" });
    expect(await snap(x)).toEqual(before);
  });

  it("refuses when prices-include-tax is set but the class has no rate", async () => {
    const x = await setup({ tax: null });
    await c.query(
      "update retailos.tenant_settings set prices_include_tax_clothing = false where tenant_id = $1",
      [x.w.tenantA],
    );
    const r = await quote(c, x.w.cashierA1, x.w.a1.id, [{ itemId: x.s.shirtM, quantity: 1 }]);
    expect(r.ok && r.data.issues[0].code).toBe("TAX_NOT_CONFIGURED");
  });

  it("sells without tax only when the owner has explicitly switched enforcement off, and flags it", async () => {
    const x = await setup({ tax: "off" });
    const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900);
    expect(r.ok && r.data.taxConfigured).toBe(false);
    expect(r.ok && r.data.taxTotalPaise).toBe(0);
    const inv = await c.query(
      "select tax_configured, tax_total from retailos.invoices where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(inv.rows[0]).toEqual({ tax_configured: false, tax_total: "0.00" });
  });

  it("the change to tax enforcement is audited", async () => {
    const x = await setup({ tax: "off" });
    const a = await c.query(
      "select count(*)::int n from retailos.audit_logs where tenant_id = $1 and entity_type = 'tenant_settings'",
      [x.w.tenantA],
    );
    expect(a.rows[0].n).toBeGreaterThan(0);
  });

  it("tax-exclusive pricing adds tax on top and splits it CGST/SGST", async () => {
    const x = await setup({ tax: "exclusive" });
    const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(142890)], 142890);
    expect(r.ok).toBe(true);
    const inv = await c.query(
      "select taxable_total, cgst_total, sgst_total, igst_total, tax_total, grand_total from retailos.invoices where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(inv.rows[0]).toEqual({
      taxable_total: "1299.00",
      cgst_total: "64.95",
      sgst_total: "64.95",
      igst_total: "0.00",
      tax_total: "129.90",
      grand_total: "1428.90",
    });
    const line = await c.query(
      "select gst_rate_pct, taxable_value, line_total, price_includes_tax from retailos.invoice_items where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(line.rows[0]).toMatchObject({
      gst_rate_pct: "10.0000",
      taxable_value: "1299.00",
      line_total: "1428.90",
      price_includes_tax: false,
    });
  });

  it("tax-inclusive pricing keeps the price and extracts the tax", async () => {
    const x = await setup({ tax: "inclusive" });
    const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900);
    expect(r.ok).toBe(true);
    const inv = await c.query(
      "select taxable_total, tax_total, grand_total from retailos.invoices where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(inv.rows[0]).toEqual({
      taxable_total: "1180.91",
      tax_total: "118.09",
      grand_total: "1299.00",
    });
  });

  it("rounds half-up and gives the odd paisa to SGST", async () => {
    const x = await setup({ tax: "exclusive" });
    // 5 paise at the test rate: tax 0.5 paise rounds up to 1; CGST 0, SGST 1
    const q = await quote(c, x.w.cashierA1, x.w.a1.id, [{ itemId: x.s.pennyTee, quantity: 1 }]);
    expect(q.ok && q.data.lines[0]).toMatchObject({
      taxPaise: 1,
      cgstPaise: 0,
      sgstPaise: 1,
      lineTotalPaise: 6,
    });
  });

  it("uses the rate effective on the business date, not a later one", async () => {
    const x = await setup({ tax: "exclusive" });
    await c.query("update retailos.tax_rates set effective_to = current_date where tenant_id = $1", [
      x.w.tenantA,
    ]);
    const q = await quote(c, x.w.cashierA1, x.w.a1.id, [{ itemId: x.s.shirtM, quantity: 1 }]);
    expect(q.ok && q.data.issues[0].code).toBe("TAX_NOT_CONFIGURED");
  });

  it("tax rate periods cannot overlap and used rates cannot be edited", async () => {
    const x = await setup({ tax: "exclusive" });
    expect(
      await expectFail(() =>
        c.query(
          "insert into retailos.tax_rates (tenant_id, tax_class_id, effective_from, gst_rate_pct) values ($1,$2,'2020-01-01',5)",
          [x.w.tenantA, x.s.taxClass],
        ),
      ),
    ).toBe("TAX_RATE_OVERLAP");
    expect(
      await expectFail(() =>
        c.query("update retailos.tax_rates set gst_rate_pct = 99 where tenant_id = $1", [
          x.w.tenantA,
        ]),
      ),
    ).toBe("TAX_RATE_IMMUTABLE");
  });
});

// ---------------------------------------------------------------------------------------------
describe("happy path and its side effects", () => {
  it("sells a mixed cart: invoice, lines, payments, stock, ledger, serialized status and audit", async () => {
    const x = await setup({ tax: "off" });
    const lines = [
      { itemId: x.s.shirtM, quantity: 2 },
      { itemId: x.s.necklace1, quantity: 1 },
      { itemId: x.s.chain, quantity: 1 },
    ];
    const total = 129900 * 2 + 49900 + 4850000;
    const r = await sell(x, lines, [cash(total, total + 500)], total);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      invoiceNumber: "INV-000001",
      grandTotalPaise: total,
      paidPaise: total,
      changePaise: 500,
      replayed: false,
    });

    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].on_hand,
    ).toBe(3);
    const st = await c.query(
      "select tag_code, status, sold_invoice_item_id is not null as linked from retailos.jewellery_items where tenant_id = $1 and tag_code in ('IJ0000123','GJ0000045') order by tag_code",
      [x.w.tenantA],
    );
    expect(st.rows).toEqual([
      { tag_code: "GJ0000045", status: "SOLD", linked: true },
      { tag_code: "IJ0000123", status: "SOLD", linked: true },
    ]);

    const mv = await c.query(
      "select item_type, quantity_delta, balance_after from retailos.inventory_movements where tenant_id = $1 and movement_type = 'SALE' order by id",
      [x.w.tenantA],
    );
    expect(mv.rows).toHaveLength(3);
    expect(mv.rows.filter((m) => m.item_type === "VARIANT")).toEqual([
      { item_type: "VARIANT", quantity_delta: -2, balance_after: 3 },
    ]);

    const pay = await c.query(
      "select method, amount, tendered_amount, change_amount from retailos.payments where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(pay.rows).toHaveLength(1);
    expect(pay.rows[0].method).toBe("CASH");
    expect(Number(pay.rows[0].amount) * 100).toBe(total);
    expect(Number(pay.rows[0].change_amount) * 100).toBe(500);

    const audit = await c.query(
      "select actor_user_id, action from retailos.audit_logs where tenant_id = $1 and entity_type = 'invoice'",
      [x.w.tenantA],
    );
    expect(audit.rows).toEqual([{ actor_user_id: x.w.cashierA1, action: "invoice.insert" }]);
  });

  it("stores an immutable snapshot on every line", async () => {
    const x = await setup({ tax: "off" });
    await sell(x, [{ itemId: x.s.chain, quantity: 1 }], [cash(4850000)], 4850000);
    const line = await c.query(
      "select description, code_snapshot, unit_price, pricing_mode, product_kind, quantity from retailos.invoice_items where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(line.rows[0]).toMatchObject({
      description: "Gold Chain 22K",
      code_snapshot: "GJ0000045",
      unit_price: "48500.00",
      pricing_mode: "FIXED_TAG",
      product_kind: "PRECIOUS_JEWELLERY",
      quantity: 1,
    });
    // changing the catalogue afterwards does not alter the old bill
    await c
      .query("update retailos.jewellery_items set tag_price = 1 where id = $1", [x.s.chain])
      .catch(() => {});
    const again = await c.query(
      "select unit_price from retailos.invoice_items where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(again.rows[0].unit_price).toBe("48500.00");
  });

  it("numbers invoices consecutively per branch and financial year", async () => {
    const x = await setup({ tax: "off" });
    for (let i = 1; i <= 3; i++) {
      const r = await sell(x, [{ itemId: x.s.jeans, quantity: 1 }], [cash(189900)], 189900);
      expect(r.ok && r.data.invoiceNumber).toBe(`INV-00000${i}`);
    }
    const inv = await c.query(
      "select financial_year from retailos.invoices where tenant_id = $1 limit 1",
      [x.w.tenantA],
    );
    expect(inv.rows[0].financial_year).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("authorisation inside the function (TC-SEC-05, 17)", () => {
  it("refuses callers without pos.sell in this branch, and changes nothing", async () => {
    const x = await setup({ tax: "off" });
    const before = await snap(x);
    const lines = [{ itemId: x.s.shirtM, quantity: 1 }];
    for (const [who, label] of [
      [x.w.cashierA2, "cashier of another branch"],
      [x.w.cashierB1, "cashier of another tenant"],
      [x.w.ownerB, "owner of another tenant"],
      [x.w.outsider, "user with no membership"],
      [x.w.platformAdmin, "platform admin"],
    ] as const) {
      const r = await checkout(c, who, {
        branch: x.w.a1.id,
        counter: x.w.a1.counterId,
        lines,
        payments: [cash(129900)],
        expected: 129900,
      });
      expect(r, label).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await snap(x)).toEqual(before);
  });

  it("refuses anonymous callers outright", async () => {
    const x = await setup({ tax: "off" });
    const r = await checkout(c, null, {
      branch: x.w.a1.id,
      counter: x.w.a1.counterId,
      lines: [{ itemId: x.s.shirtM, quantity: 1 }],
      payments: [cash(129900)],
      expected: 129900,
    });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).code).toMatch(/permission denied/i);
  });

  it("derives the tenant from the branch: a forged item from another tenant is simply not found", async () => {
    const x = await setup({ tax: "off" });
    const r = await sell(x, [{ itemId: crypto.randomUUID(), quantity: 1 }], [cash(100)], 100);
    expect(r).toMatchObject({ ok: false, code: "ITEM_NOT_FOUND" });
  });

  it("a revoked cashier cannot sell on the next call", async () => {
    const x = await setup({ tax: "off" });
    await asUser(c, x.w.ownerA, (y) =>
      y.query("select retailos.membership_set_status($1,$2,'DISABLED')", [
        x.w.tenantA,
        x.w.cashierA1,
      ]),
    );
    const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900);
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("a suspended tenant cannot sell", async () => {
    const x = await setup({ tax: "off" });
    await c.query("update retailos.tenants set status = 'SUSPENDED' where id = $1", [x.w.tenantA]);
    const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900);
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("the client cannot choose prices, totals or anything else", () => {
  it("rejects a client-supplied price or any unknown field", async () => {
    const x = await setup({ tax: "off" });
    const before = await snap(x);
    for (const line of [
      { itemId: x.s.shirtM, quantity: 1, unitPricePaise: 1 },
      { itemId: x.s.shirtM, quantity: 1, price: 1 },
      { itemId: x.s.shirtM, quantity: 1, taxPaise: 0 },
    ]) {
      expect(await sell(x, [line], [cash(1)], 1), JSON.stringify(line)).toMatchObject({
        ok: false,
        code: "VALIDATION_ERROR",
      });
    }
    expect(
      await sell(
        x,
        [{ itemId: x.s.shirtM, quantity: 1 }],
        [{ method: "CASH", amountPaise: 129900, status: "PAID" }],
        129900,
      ),
    ).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(
      await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900, {
        customer: { name: "A", vip: true },
      }),
    ).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(await snap(x)).toEqual(before);
  });

  it("rejects malformed quantities, ids and duplicates", async () => {
    const x = await setup({ tax: "off" });
    for (const lines of [
      [{ itemId: x.s.shirtM, quantity: 0 }],
      [{ itemId: x.s.shirtM, quantity: -1 }],
      [{ itemId: x.s.shirtM, quantity: 1.5 }],
      [{ itemId: x.s.shirtM, quantity: 1000 }],
      [{ itemId: "not-a-uuid", quantity: 1 }],
      [{ itemId: x.s.shirtM, quantity: "1" }],
      [
        { itemId: x.s.shirtM, quantity: 1 },
        { itemId: x.s.shirtM, quantity: 1 },
      ],
    ]) {
      const r = await sell(x, lines, [cash(129900)], 129900);
      expect(r, JSON.stringify(lines)).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    }
    expect(await sell(x, [], [cash(1)], 0)).toMatchObject({ ok: false, code: "CART_EMPTY" });
  });

  it("rejects a total the cashier did not see", async () => {
    const x = await setup({ tax: "off" });
    const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(100)], 100);
    expect(r).toMatchObject({ ok: false, code: "PRICE_STALE" });
    expect((r as any).detail.quote.grandTotalPaise).toBe(129900); // fresh quote is returned
  });

  it("reflects a price change made after the quote", async () => {
    const x = await setup({ tax: "off" });
    await c.query("update retailos.product_variants set selling_price = 1399.00 where id = $1", [
      x.s.shirtM,
    ]);
    const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900);
    expect(r).toMatchObject({ ok: false, code: "PRICE_STALE" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("discounts are authorised inside the database (default deny)", () => {
  const disc = (x: Ctx, paise: number, reason = "Festival offer") => [
    { itemId: x.s.shirtM, quantity: 1, discountPaise: paise, discountReason: reason },
  ];

  it("a cashier or manager with no configured limit cannot give any discount", async () => {
    const x = await setup({ tax: "off" });
    const before = await snap(x);
    const r = await sell(x, disc(x, 1), [cash(129899)], 129899);
    expect(r).toMatchObject({ ok: false, code: "DISCOUNT_NOT_ALLOWED" });
    const m = await checkout(c, x.w.managerA1, {
      branch: x.w.a1.id,
      counter: x.w.a1.counterId,
      lines: disc(x, 1),
      payments: [cash(129899)],
      expected: 129899,
    });
    expect(m).toMatchObject({ ok: false, code: "DISCOUNT_NOT_ALLOWED" });
    expect(await snap(x)).toEqual(before);
  });

  it("the owner is unrestricted but still needs a reason", async () => {
    const x = await setup({ tax: "off" });
    const own = (lines: unknown[], total: number) =>
      checkout(c, x.w.ownerA, {
        branch: x.w.a1.id,
        counter: x.w.a1.counterId,
        lines,
        payments: [cash(total)],
        expected: total,
      });
    expect(await own(disc(x, 10000, ""), 119900)).toMatchObject({
      ok: false,
      code: "DISCOUNT_REASON_REQUIRED",
    });
    expect(await own(disc(x, 10000, "   "), 119900)).toMatchObject({
      ok: false,
      code: "DISCOUNT_REASON_REQUIRED",
    });
    const ok = await own(disc(x, 10000), 119900);
    expect(ok.ok && ok.data.grandTotalPaise).toBe(119900);
    const line = await c.query(
      "select discount_amount, discount_reason from retailos.invoice_items where tenant_id = $1",
      [x.w.tenantA],
    );
    expect(line.rows[0]).toEqual({ discount_amount: "100.00", discount_reason: "Festival offer" });
  });

  it("a configured percentage limit is enforced exactly at, below and above the boundary", async () => {
    const x = await setup({ tax: "off" });
    // a manager holds discount.apply by default; the owner sets the limit through the function
    await asUser(c, x.w.ownerA, (y) =>
      y.query("select retailos.discount_limit_set($1, 'branch_manager', 500)", [x.w.tenantA]),
    );
    const asManager = (lines: unknown[]) => quote(c, x.w.managerA1, x.w.a1.id, lines);
    // 5% of 129900 = 6495 exactly
    expect((await asManager(disc(x, 6494))).data.issues).toEqual([]);
    expect((await asManager(disc(x, 6495))).data.issues).toEqual([]);
    expect((await asManager(disc(x, 6496))).data.issues[0].code).toBe("DISCOUNT_NOT_ALLOWED");
    const ok = await checkout(c, x.w.managerA1, {
      branch: x.w.a1.id,
      counter: x.w.a1.counterId,
      lines: disc(x, 6495),
      payments: [cash(129900 - 6495)],
      expected: 129900 - 6495,
    });
    expect(ok.ok).toBe(true);
    // the cashier has no discount.apply, so the same limit does not help them
    expect((await quote(c, x.w.cashierA1, x.w.a1.id, disc(x, 1))).data.issues[0].code).toBe(
      "DISCOUNT_NOT_ALLOWED",
    );
  });
  it("a limit set for one tenant never applies in another", async () => {
    const x = await setup({ tax: "off" });
    const managerRole = (await c.query("select id from retailos.roles where key = 'branch_manager'"))
      .rows[0].id;
    await c.query(
      "insert into retailos.role_discount_limits (tenant_id, role_id, max_line_discount_bps) values ($1,$2,10000)",
      [x.w.tenantB, managerRole],
    );
    expect((await quote(c, x.w.managerA1, x.w.a1.id, disc(x, 1))).data.issues[0].code).toBe(
      "DISCOUNT_NOT_ALLOWED",
    );
  });
  it("never allows a discount above the line, a negative or fractional one, or a zero-value bill", async () => {
    const x = await setup({ tax: "off" });
    const own = (lines: unknown[], total: number) =>
      checkout(c, x.w.ownerA, {
        branch: x.w.a1.id,
        counter: x.w.a1.counterId,
        lines,
        payments: [cash(Math.max(total, 1))],
        expected: total,
      });
    expect(await own(disc(x, 129901), 0)).toMatchObject({
      ok: false,
      code: "DISCOUNT_NOT_ALLOWED",
    });
    for (const bad of [-1, 0.5, "5", 10 ** 13]) {
      expect(await own(disc(x, bad as number), 0), String(bad)).toMatchObject({
        ok: false,
        code: "VALIDATION_ERROR",
      });
    }
    expect(await own(disc(x, 129900), 0)).toMatchObject({ ok: false, code: "TOTAL_NOT_PAYABLE" });
  });

  it("applies the discount before tax", async () => {
    const x = await setup({ tax: "exclusive" });
    const r = await checkout(c, x.w.ownerA, {
      branch: x.w.a1.id,
      counter: x.w.a1.counterId,
      lines: disc(x, 29900),
      payments: [cash(110000)],
      expected: 110000,
    });
    // (1299 - 299) = 1000.00 taxable + 10% = 1100.00
    expect(r.ok && r.data.grandTotalPaise).toBe(110000);
  });
});

// ---------------------------------------------------------------------------------------------
describe("stock and serialized items", () => {
  it("refuses to oversell and leaves everything untouched", async () => {
    const x = await setup({ tax: "off" });
    const before = await snap(x);
    const r = await sell(x, [{ itemId: x.s.shirtL, quantity: 2 }], [cash(259800)], 259800); // stock 1
    expect(r).toMatchObject({ ok: false, code: "INSUFFICIENT_STOCK" });
    expect(await snap(x)).toEqual(before);
  });

  it("sells the last unit, then refuses the next", async () => {
    const x = await setup({ tax: "off" });
    expect((await sell(x, [{ itemId: x.s.shirtL, quantity: 1 }], [cash(129900)], 129900)).ok).toBe(
      true,
    );
    expect(
      await sell(x, [{ itemId: x.s.shirtL, quantity: 1 }], [cash(129900)], 129900),
    ).toMatchObject({ ok: false, code: "INSUFFICIENT_STOCK" });
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.shirtL,
        ])
      ).rows[0].on_hand,
    ).toBe(0);
  });

  it("gives a specific reason for each unsellable serialized piece", async () => {
    const x = await setup({ tax: "off" });
    const code = async (id: string) => {
      const r = await quote(c, x.w.cashierA1, x.w.a1.id, [{ itemId: id, quantity: 1 }]);
      return r.ok ? r.data.issues[0]?.code : r.code;
    };
    expect(await code(x.s.necklace2)).toBe("ITEM_ALREADY_SOLD");
    expect(await code(x.s.earrings)).toBe("ITEM_ON_HOLD");
    expect(await code(x.s.bangleA2)).toBe("ITEM_NOT_IN_BRANCH");
    expect(await code(x.s.ring)).toBe("RULE_NOT_CONFIGURED"); // metal-rate pricing awaits the client (OQ-01)
    const qQty = await quote(c, x.w.cashierA1, x.w.a1.id, [{ itemId: x.s.necklace1, quantity: 2 }]);
    expect(qQty.ok && qQty.data.issues[0]?.code).toBe("VALIDATION_ERROR");
  });

  it("a sold piece cannot be sold again and the first sale is unaffected", async () => {
    const x = await setup({ tax: "off" });
    expect((await sell(x, [{ itemId: x.s.necklace1, quantity: 1 }], [cash(49900)], 49900)).ok).toBe(
      true,
    );
    const again = await sell(x, [{ itemId: x.s.necklace1, quantity: 1 }], [cash(49900)], 49900);
    expect(again).toMatchObject({ ok: false, code: "ITEM_ALREADY_SOLD" });
    expect((await snap(x)).invoices).toBe(1);
  });

  it("an inactive item or product cannot be sold", async () => {
    const x = await setup({ tax: "off" });
    await c.query("update retailos.product_variants set is_active = false where id = $1", [
      x.s.jeans,
    ]);
    await c.query("update retailos.jewellery_items set is_active = false where id = $1", [
      x.s.necklace1,
    ]);
    for (const id of [x.s.jeans, x.s.necklace1]) {
      const qInactive = await quote(c, x.w.cashierA1, x.w.a1.id, [{ itemId: id, quantity: 1 }]);
      expect(qInactive.ok && qInactive.data.issues[0]?.code).toBe("ITEM_INACTIVE");
    }
  });

  it("a branch cannot sell another branch's stock", async () => {
    const x = await setup({ tax: "off" });
    // A2 has no stock of the shirt; selling it from A2 fails even though A1 has plenty
    await c.query(
      "insert into retailos.cash_sessions (tenant_id, branch_id, counter_id, business_date, opening_float, opened_by) values ($1,$2,$3,current_date,0,$4)",
      [x.w.tenantA, x.w.a2.id, x.w.a2.counterId, x.w.cashierA2],
    );
    const r = await checkout(c, x.w.cashierA2, {
      branch: x.w.a2.id,
      counter: x.w.a2.counterId,
      lines: [{ itemId: x.s.shirtM, quantity: 1 }],
      payments: [cash(129900)],
      expected: 129900,
    });
    expect(r).toMatchObject({ ok: false, code: "INSUFFICIENT_STOCK" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("payments reconcile with the server total", () => {
  const lines = (x: Ctx) => [{ itemId: x.s.shirtM, quantity: 1 }];

  it("rejects under-payment, over-payment and no payment", async () => {
    const x = await setup({ tax: "off" });
    for (const amt of [129899, 129901])
      expect(await sell(x, lines(x), [cash(amt)], 129900)).toMatchObject({
        ok: false,
        code: "PAYMENT_MISMATCH",
      });
    expect(await sell(x, lines(x), [], 129900)).toMatchObject({
      ok: false,
      code: "PAYMENT_MISMATCH",
    });
    expect((await snap(x)).invoices).toBe(0);
  });

  it("rejects zero, negative, fractional or unknown payments", async () => {
    const x = await setup({ tax: "off" });
    for (const p of [
      { method: "CASH", amountPaise: 0 },
      { method: "CASH", amountPaise: -5 },
      { method: "CASH", amountPaise: 1.5 },
      { method: "BITCOIN", amountPaise: 129900, confirmedReceived: true },
      { method: "CREDIT", amountPaise: 129900, confirmedReceived: true },
    ]) {
      expect(await sell(x, lines(x), [p], 129900), JSON.stringify(p)).toMatchObject({
        ok: false,
        code: "VALIDATION_ERROR",
      });
    }
  });

  it("never records UPI or card as received without explicit confirmation", async () => {
    const x = await setup({ tax: "off" });
    for (const method of ["UPI", "CARD"]) {
      expect(await sell(x, lines(x), [{ method, amountPaise: 129900 }], 129900)).toMatchObject({
        ok: false,
        code: "PAYMENT_NOT_CONFIRMED",
      });
      expect(
        await sell(
          x,
          lines(x),
          [{ method, amountPaise: 129900, confirmedReceived: false }],
          129900,
        ),
      ).toMatchObject({ ok: false, code: "PAYMENT_NOT_CONFIRMED" });
      expect(
        await sell(
          x,
          lines(x),
          [{ method, amountPaise: 129900, confirmedReceived: "true" }],
          129900,
        ),
      ).toMatchObject({ ok: false, code: "PAYMENT_NOT_CONFIRMED" });
    }
    expect(await snap(x)).toMatchObject({ invoices: 0, payments: 0 });
  });

  it("rejects cash tendered below the amount due", async () => {
    const x = await setup({ tax: "off" });
    expect(await sell(x, lines(x), [cash(129900, 100000)], 129900)).toMatchObject({
      ok: false,
      code: "CASH_TENDER_TOO_LOW",
    });
  });

  it("accepts an exact split across methods and records each part", async () => {
    const x = await setup({ tax: "off" });
    const r = await sell(
      x,
      lines(x),
      [
        { method: "UPI", amountPaise: 100000, confirmedReceived: true, reference: "UPI-REF-1" },
        cash(29900, 30000),
      ],
      129900,
    );
    expect(r.ok && r.data.changePaise).toBe(100);
    const p = await c.query(
      "select method, amount, reference_no from retailos.payments where tenant_id = $1 order by method",
      [x.w.tenantA],
    );
    expect(p.rows).toEqual([
      { method: "CASH", amount: "299.00", reference_no: null },
      { method: "UPI", amount: "1000.00", reference_no: "UPI-REF-1" },
    ]);
  });

  it("a failed payment leaves stock and serialized pieces untouched", async () => {
    const x = await setup({ tax: "off" });
    const before = await snap(x);
    const r = await sell(
      x,
      [
        { itemId: x.s.shirtM, quantity: 1 },
        { itemId: x.s.chain, quantity: 1 },
      ],
      [{ method: "CARD", amountPaise: 4979900 }],
      4979900,
    );
    expect(r).toMatchObject({ ok: false, code: "PAYMENT_NOT_CONFIRMED" });
    expect(await snap(x)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("idempotency", () => {
  it("returns the original invoice for a repeated request and creates nothing new", async () => {
    const x = await setup({ tax: "off" });
    const key = crypto.randomUUID();
    const a = await sell(x, [{ itemId: x.s.shirtM, quantity: 2 }], [cash(259800)], 259800, { key });
    const b = await sell(x, [{ itemId: x.s.shirtM, quantity: 2 }], [cash(259800)], 259800, { key });
    const d = await sell(x, [{ itemId: x.s.shirtM, quantity: 2 }], [cash(259800)], 259800, { key });
    expect(a.ok && b.ok && d.ok).toBe(true);
    if (a.ok && b.ok && d.ok) {
      expect([a.data.replayed, b.data.replayed, d.data.replayed]).toEqual([false, true, true]);
      expect(b.data.invoiceId).toBe(a.data.invoiceId);
      expect(d.data.invoiceNumber).toBe(a.data.invoiceNumber);
    }
    const s = await snap(x);
    expect(s).toMatchObject({ invoices: 1, payments: 1, sale_movements: 1 });
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].on_hand,
    ).toBe(3);
  });

  it("treats a different line order as the same request", async () => {
    const x = await setup({ tax: "off" });
    const key = crypto.randomUUID();
    const total = 129900 + 49900;
    const a = await sell(
      x,
      [
        { itemId: x.s.shirtM, quantity: 1 },
        { itemId: x.s.necklace1, quantity: 1 },
      ],
      [cash(total)],
      total,
      { key },
    );
    const b = await sell(
      x,
      [
        { itemId: x.s.necklace1, quantity: 1 },
        { itemId: x.s.shirtM, quantity: 1 },
      ],
      [cash(total)],
      total,
      { key },
    );
    expect(a.ok && b.ok && b.data.replayed).toBe(true);
  });

  it("refuses a reused key with any different content (cart, payment, discount, customer)", async () => {
    const x = await setup({ tax: "off" });
    const key = crypto.randomUUID();
    expect(
      (await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900, { key })).ok,
    ).toBe(true);
    const variants: Array<[unknown[], unknown[], number, Record<string, unknown>]> = [
      [[{ itemId: x.s.jeans, quantity: 1 }], [cash(189900)], 189900, {}],
      [
        [{ itemId: x.s.shirtM, quantity: 1 }],
        [{ method: "UPI", amountPaise: 129900, confirmedReceived: true }],
        129900,
        {},
      ],
      [[{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900, 130000)], 129900, {}],
      [
        [{ itemId: x.s.shirtM, quantity: 1 }],
        [cash(129900)],
        129900,
        { customer: { name: "Someone" } },
      ],
    ];
    for (const [l, p, e, extra] of variants) {
      expect(await sell(x, l, p, e, { key, ...extra })).toMatchObject({
        ok: false,
        code: "IDEMPOTENCY_KEY_REUSED",
      });
    }
    expect((await snap(x)).invoices).toBe(1);
  });

  it("binds the key to the user who first used it", async () => {
    const x = await setup({ tax: "off" });
    const key = crypto.randomUUID();
    expect(
      (await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900, { key })).ok,
    ).toBe(true);
    const other = await checkout(c, x.w.managerA1, {
      branch: x.w.a1.id,
      counter: x.w.a1.counterId,
      key,
      lines: [{ itemId: x.s.shirtM, quantity: 1 }],
      payments: [cash(129900)],
      expected: 129900,
    });
    expect(other).toMatchObject({ ok: false, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("a failed attempt stores nothing, so the same key can be retried after the cause is fixed", async () => {
    const x = await setup({ tax: "off" });
    const key = crypto.randomUUID();
    const bad = await sell(
      x,
      [{ itemId: x.s.shirtM, quantity: 1 }],
      [{ method: "UPI", amountPaise: 129900 }],
      129900,
      { key },
    );
    expect(bad).toMatchObject({ ok: false, code: "PAYMENT_NOT_CONFIRMED" });
    expect((await snap(x)).keys).toBe(0);
    const good = await sell(
      x,
      [{ itemId: x.s.shirtM, quantity: 1 }],
      [{ method: "UPI", amountPaise: 129900, confirmedReceived: true }],
      129900,
      { key },
    );
    expect(good.ok).toBe(true);
    expect((await snap(x)).invoices).toBe(1);
  });

  it("the same key in two tenants is two independent keys", async () => {
    const x = await setup({ tax: "off" });
    const key = crypto.randomUUID();
    const y = await setup({ tax: "off" });
    const a = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900, { key });
    const b = await sell(y, [{ itemId: y.s.shirtM, quantity: 1 }], [cash(129900)], 129900, { key });
    expect(a.ok && b.ok && !b.data.replayed).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the day must be started", () => {
  it("refuses to sell with no open session, and the cashier can start the day", async () => {
    const x = await setup({ tax: "off", start: false });
    expect(
      await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900),
    ).toMatchObject({ ok: false, code: "SESSION_NOT_OPEN" });
    expect((await startDay(c, x.w.cashierA1, x.w.a1.id, x.w.a1.counterId, 50000)).ok).toBe(true);
    expect((await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900)).ok).toBe(
      true,
    );
  });

  it("starting twice keeps one open session and one audit entry", async () => {
    const x = await setup({ tax: "off", start: false });
    await startDay(c, x.w.cashierA1, x.w.a1.id, x.w.a1.counterId);
    await startDay(c, x.w.cashierA1, x.w.a1.id, x.w.a1.counterId);
    expect(
      (
        await c.query(
          "select count(*)::int n from retailos.cash_sessions where tenant_id = $1 and status = 'OPEN'",
          [x.w.tenantA],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await c.query(
          "select count(*)::int n from retailos.audit_logs where tenant_id = $1 and action = 'cash_session.open'",
          [x.w.tenantA],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("a counter from another branch or tenant cannot be used", async () => {
    const x = await setup({ tax: "off", start: false });
    expect(await startDay(c, x.w.cashierA1, x.w.a1.id, x.w.a2.counterId)).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await startDay(c, x.w.cashierA1, x.w.a1.id, x.w.b1.counterId)).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await startDay(c, x.w.cashierA2, x.w.a1.id, x.w.a1.counterId)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("rollback: all-or-nothing in a real transaction (TC-CHK-09)", () => {
  it("a failure AFTER the invoice, lines and stock were written undoes all of it", async () => {
    const x = await setup({ tax: "off" });
    await c.query(
      `create or replace function retailos.test_boom() returns trigger language plpgsql as $$ begin raise exception 'BOOM_AFTER_WRITES'; end $$;
       create trigger test_boom_payments before insert on retailos.payments for each row execute function retailos.test_boom();`,
    );
    try {
      const before = await snap(x);
      const r = await sell(
        x,
        [
          { itemId: x.s.shirtM, quantity: 2 },
          { itemId: x.s.necklace1, quantity: 1 },
          { itemId: x.s.chain, quantity: 1 },
        ],
        [cash(5159700)],
        129900 * 2 + 49900 + 4850000,
      );
      expect(r).toMatchObject({ ok: false, code: "BOOM_AFTER_WRITES" });
      // invoice, items, stock decrement, SOLD status, movements, sequence number, idempotency key: all gone
      expect(await snap(x)).toEqual(before);
      expect(
        (
          await c.query("select count(*)::int n from retailos.invoice_items where tenant_id = $1", [
            x.w.tenantA,
          ])
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await c.query(
        "drop trigger test_boom_payments on retailos.payments; drop function retailos.test_boom();",
      );
    }
    // the invoice number was NOT consumed: the next real sale is number 1
    const ok = await sell(x, [{ itemId: x.s.jeans, quantity: 1 }], [cash(189900)], 189900);
    expect(ok.ok && ok.data.invoiceNumber).toBe("INV-000001");
  });

  it("a failure inside the stock update undoes the invoice too", async () => {
    const x = await setup({ tax: "off" });
    await c.query(
      `create or replace function retailos.test_boom2() returns trigger language plpgsql as $$ begin raise exception 'BOOM_IN_LEDGER'; end $$;
       create trigger test_boom_ledger before insert on retailos.inventory_movements for each row execute function retailos.test_boom2();`,
    );
    try {
      const before = await snap(x);
      const r = await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900);
      expect(r).toMatchObject({ ok: false, code: "BOOM_IN_LEDGER" });
      expect(await snap(x)).toEqual(before);
    } finally {
      await c.query(
        "drop trigger test_boom_ledger on retailos.inventory_movements; drop function retailos.test_boom2();",
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("the database enforces integrity on its own (independent of the function)", () => {
  async function sold(x: Ctx) {
    const r = await sell(
      x,
      [
        { itemId: x.s.shirtM, quantity: 1 },
        { itemId: x.s.necklace1, quantity: 1 },
      ],
      [cash(179800)],
      179800,
    );
    expect(r.ok).toBe(true);
    return r.ok ? r.data.invoiceId : "";
  }

  it("API roles have no write privilege on any sales or ledger table", async () => {
    const x = await setup({ tax: "off" });
    const id = await sold(x);
    for (const t of [
      "invoices",
      "invoice_items",
      "payments",
      "inventory_movements",
      "inventory_balances",
      "cash_sessions",
      "document_sequences",
      "idempotency_keys",
      "jewellery_items",
    ]) {
      for (const stmt of [
        `insert into retailos.${t} default values`,
        `update retailos.${t} set tenant_id = tenant_id`,
        `delete from retailos.${t}`,
      ]) {
        const msg = await probe(c, x.w.ownerA, (y) => refused(y, stmt));
        expect(msg, `${t}: ${stmt}`).toMatch(/permission denied|must be owner/i);
      }
    }
    expect(id).not.toBe("");
  });

  it("invoices, lines, payments and the ledger cannot be changed even by the superuser", async () => {
    const x = await setup({ tax: "off" });
    await sold(x);
    for (const t of ["invoices", "invoice_items", "payments", "inventory_movements"]) {
      expect(
        await expectFail(() => c.query(`update retailos.${t} set tenant_id = tenant_id`)),
        t,
      ).toMatch(/append-only/);
      expect(await expectFail(() => c.query(`delete from retailos.${t}`)), t).toMatch(/append-only/);
      expect(await expectFail(() => c.query(`truncate retailos.${t} cascade`)), t).toMatch(
        /append-only/,
      );
    }
  });

  it("rejects an invoice whose payments do not equal its total, even when inserted directly", async () => {
    const x = await setup({ tax: "off" });
    const sess = (
      await c.query("select id from retailos.cash_sessions where tenant_id = $1", [x.w.tenantA])
    ).rows[0].id;
    await c.query("begin");
    try {
      await c.query(
        `insert into retailos.invoices (id, tenant_id, branch_id, counter_id, cash_session_id, invoice_number, financial_year, business_date,
           cashier_user_id, place_of_supply_state_code, gross_total, taxable_total, grand_total, paid_total, tax_configured, idempotency_key)
         values ('11111111-1111-1111-1111-111111111111',$1,$2,$3,$4,'X-1','2026-27',current_date,$5,'TS',10,10,10,10,false,gen_random_uuid())`,
        [x.w.tenantA, x.w.a1.id, x.w.a1.counterId, sess, x.w.cashierA1],
      );
      await c.query(
        `insert into retailos.invoice_items (tenant_id, branch_id, invoice_id, line_no, item_type, variant_id, product_kind, description, code_snapshot,
           quantity, unit_price, pricing_mode, gross_amount, taxable_value, line_total)
         values ($1,$2,'11111111-1111-1111-1111-111111111111',1,'VARIANT',$3,'CLOTHING','x','x',1,10,'VARIANT_PRICE',10,10,10)`,
        [x.w.tenantA, x.w.a1.id, x.s.shirtM],
      );
      // no payment row at all
      const msg = await expectFail(() => c.query("commit"));
      expect(msg).toMatch(/payments .* do not equal the total/);
    } finally {
      await c.query("rollback").catch(() => {});
    }
    expect(
      (await c.query("select count(*)::int n from retailos.invoices where invoice_number = 'X-1'"))
        .rows[0].n,
    ).toBe(0);
  });

  it("rejects an invoice whose lines do not add up to its total", async () => {
    const x = await setup({ tax: "off" });
    const sess = (
      await c.query("select id from retailos.cash_sessions where tenant_id = $1", [x.w.tenantA])
    ).rows[0].id;
    await c.query("begin");
    try {
      await c.query(
        `insert into retailos.invoices (id, tenant_id, branch_id, counter_id, cash_session_id, invoice_number, financial_year, business_date,
           cashier_user_id, place_of_supply_state_code, gross_total, taxable_total, grand_total, paid_total, tax_configured, idempotency_key)
         values ('22222222-2222-2222-2222-222222222222',$1,$2,$3,$4,'X-2','2026-27',current_date,$5,'TS',999,999,999,999,false,gen_random_uuid())`,
        [x.w.tenantA, x.w.a1.id, x.w.a1.counterId, sess, x.w.cashierA1],
      );
      await c.query(
        `insert into retailos.invoice_items (tenant_id, branch_id, invoice_id, line_no, item_type, variant_id, product_kind, description, code_snapshot,
           quantity, unit_price, pricing_mode, gross_amount, taxable_value, line_total)
         values ($1,$2,'22222222-2222-2222-2222-222222222222',1,'VARIANT',$3,'CLOTHING','x','x',1,10,'VARIANT_PRICE',10,10,10)`,
        [x.w.tenantA, x.w.a1.id, x.s.shirtM],
      );
      await c.query(
        `insert into retailos.payments (tenant_id, branch_id, cash_session_id, invoice_id, method, amount, tendered_amount, change_amount, recorded_by)
         values ($1,$2,$3,'22222222-2222-2222-2222-222222222222','CASH',999,999,0,$4)`,
        [x.w.tenantA, x.w.a1.id, sess, x.w.cashierA1],
      );
      const msg = await expectFail(() => c.query("commit"));
      expect(msg).toMatch(/does not reconcile with its lines/);
    } finally {
      await c.query("rollback").catch(() => {});
    }
  });

  it("a second live sale line for the same piece is blocked by a unique index", async () => {
    const x = await setup({ tax: "off" });
    await sold(x);
    const inv = (
      await c.query("select id, branch_id from retailos.invoices where tenant_id = $1", [x.w.tenantA])
    ).rows[0];
    const msg = await expectFail(() =>
      c.query(
        `insert into retailos.invoice_items (tenant_id, branch_id, invoice_id, line_no, item_type, jewellery_item_id, product_kind, description, code_snapshot,
           quantity, unit_price, pricing_mode, gross_amount, taxable_value, line_total)
         values ($1,$2,$3,99,'JEWELLERY_ITEM',$4,'IMITATION_JEWELLERY','x','x',1,10,'FIXED_TAG',10,10,10)`,
        [x.w.tenantA, inv.branch_id, inv.id, x.s.necklace1],
      ),
    );
    expect(msg).toMatch(/invoice_items_one_live_sale_per_piece|duplicate key/);
  });

  it("stock can never be negative, and a sold piece's price is locked", async () => {
    const x = await setup({ tax: "off" });
    await sold(x);
    expect(
      await expectFail(() =>
        c.query("update retailos.inventory_balances set on_hand = -1 where variant_id = $1", [
          x.s.shirtM,
        ]),
      ),
    ).toMatch(/check constraint/);
    expect(
      await expectFail(() =>
        c.query("update retailos.jewellery_items set tag_price = 1 where id = $1", [x.s.necklace1]),
      ),
    ).toBe("ITEM_SOLD_LOCKED");
  });

  it("the ledger always equals the balances after real sales", async () => {
    const x = await setup({ tax: "off" });
    await sell(
      x,
      [
        { itemId: x.s.shirtM, quantity: 2 },
        { itemId: x.s.jeans, quantity: 3 },
      ],
      [cash(2 * 129900 + 3 * 189900)],
      2 * 129900 + 3 * 189900,
    );
    const bad = await c.query(
      `select b.variant_id from retailos.inventory_balances b
       where b.on_hand <> coalesce((select sum(quantity_delta) from retailos.inventory_movements m where m.branch_id = b.branch_id and m.variant_id = b.variant_id), 0)`,
    );
    expect(bad.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("who can see invoices (TC-SEC-04, 09)", () => {
  it("is limited to the branch and tenant; a cashier sees no invoices unless granted; costs stay hidden", async () => {
    const x = await setup({ tax: "off" });
    await sell(x, [{ itemId: x.s.shirtM, quantity: 1 }], [cash(129900)], 129900);
    const count = (who: string | null) =>
      probe(c, who, async (y) => ({
        invoices: (await y.query("select count(*)::int n from retailos.invoices")).rows[0].n,
        lines: (await y.query("select count(*)::int n from retailos.invoice_items")).rows[0].n,
        payments: (await y.query("select count(*)::int n from retailos.payments")).rows[0].n,
        movements: (await y.query("select count(*)::int n from retailos.inventory_movements")).rows[0]
          .n,
      }));
    // a cashier can SELL but, by default, cannot browse invoices, lines, payments or the stock ledger
    expect(await count(x.w.cashierA1)).toEqual({
      invoices: 0,
      lines: 0,
      payments: 0,
      movements: 0,
    });
    expect(await count(x.w.managerA1)).toMatchObject({ invoices: 1, lines: 1, payments: 1 });
    expect(await count(x.w.ownerA)).toMatchObject({ invoices: 1 });
    for (const who of [x.w.cashierA2, x.w.cashierB1, x.w.ownerB, x.w.outsider, x.w.platformAdmin]) {
      expect(await count(who)).toEqual({ invoices: 0, lines: 0, payments: 0, movements: 0 });
    }
    // costs
    await c.query(
      "insert into retailos.variant_costs (tenant_id, variant_id, cost_price) values ($1,$2,500)",
      [x.w.tenantA, x.s.shirtM],
    );
    expect(
      await probe(
        c,
        x.w.cashierA1,
        async (y) => (await y.query("select count(*)::int n from retailos.variant_costs")).rows[0].n,
      ),
    ).toBe(0);
    expect(
      await probe(
        c,
        x.w.managerA1,
        async (y) => (await y.query("select count(*)::int n from retailos.variant_costs")).rows[0].n,
      ),
    ).toBe(0);
    expect(
      await probe(
        c,
        x.w.ownerA,
        async (y) => (await y.query("select count(*)::int n from retailos.variant_costs")).rows[0].n,
      ),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("barcode resolution is exact (TC-BAR-02, 05)", () => {
  const resolve = (x: Ctx, code: string, who?: string) =>
    rpc(c, who ?? x.w.cashierA1, "select retailos.resolve_barcode($1,$2)", [x.w.a1.id, code]);

  it("resolves an exact code, ignoring case, spaces and scanner control characters", async () => {
    const x = await setup({ tax: "off" });
    for (const code of [
      "NR00000001",
      "nr00000001",
      "  NR00000001  ",
      "NR00000001\r\n",
      "NR00000001\n",
    ]) {
      const r = await resolve(x, code);
      expect(r.ok && r.data.itemId, JSON.stringify(code)).toBe(x.s.shirtM);
    }
  });

  it("never resolves a prefix, substring, neighbour or near miss", async () => {
    const x = await setup({ tax: "off" });
    for (const code of [
      "NR0000000",
      "NR000000",
      "NR",
      "0000001",
      "R00000001",
      "NR0000000%",
      "NR%",
      "%",
      "_R00000001",
      "NR00000001X",
      "NR 00000001",
      "NR-00000001",
      "IJ00001",
      "GJ0000",
      "NR00000003",
    ]) {
      expect(await resolve(x, code), JSON.stringify(code)).toMatchObject({
        ok: false,
        code: "BARCODE_NOT_FOUND",
      });
    }
  });

  it("is scoped to the caller's tenant", async () => {
    const x = await setup({ tax: "off" });
    const y = await setup({ tax: "off" });
    // same code exists in both worlds; each resolves only to its own item
    const res1 = await resolve(x, "NR00000001");
    expect(res1.ok && res1.data.itemId).toBe(x.s.shirtM);
    const res2 = await rpc(c, y.w.cashierA1, "select retailos.resolve_barcode($1,$2)", [
      y.w.a1.id,
      "NR00000001",
    ]);
    expect(res2.ok && res2.data.itemId).toBe(y.s.shirtM);
    // a user cannot resolve through a branch of another tenant
    expect(
      await rpc(c, x.w.cashierA1, "select retailos.resolve_barcode($1,$2)", [
        y.w.a1.id,
        "NR00000001",
      ]),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("does not resolve a deactivated code, and is refused for users without pos.sell", async () => {
    const x = await setup({ tax: "off" });
    await c.query(
      "update retailos.barcode_aliases set is_active = false where tenant_id = $1 and code = 'NR00000001'",
      [x.w.tenantA],
    );
    expect(await resolve(x, "NR00000001")).toMatchObject({ ok: false, code: "BARCODE_NOT_FOUND" });
    expect(await resolve(x, "NR00000002", x.w.cashierA2)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await resolve(x, "NR00000002", x.w.outsider)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("a code is unique within the tenant across variants and jewellery items", async () => {
    const x = await setup({ tax: "off" });
    const msg = await expectFail(() =>
      c.query(
        "insert into retailos.barcode_aliases (tenant_id, code, target_type, variant_id) values ($1,'IJ0000123','VARIANT',$2)",
        [x.w.tenantA, x.s.jeans],
      ),
    );
    expect(msg).toMatch(/duplicate key/);
    expect(
      await expectFail(() =>
        c.query(
          "insert into retailos.barcode_aliases (tenant_id, code, target_type, variant_id) values ($1,'lower1234','VARIANT',$2)",
          [x.w.tenantA, x.s.jeans],
        ),
      ),
    ).toMatch(/check constraint/);
  });

  it("name search never matches barcodes or tag codes, even partially", async () => {
    const x = await setup({ tax: "off" });
    const search = async (q: string) => {
      const res = await rpc(c, x.w.cashierA1, "select retailos.catalog_search($1,$2)", [
        x.w.a1.id,
        q,
      ]);
      return res.ok ? (res.data as any[]) : [];
    };
    for (const q of ["NR0000", "NR00000001", "IJ0000123", "IJ0000", "GJ0000", "0000123"]) {
      expect(await search(q), q).toEqual([]);
    }
    expect((await search("cotton shirt")).map((r) => r.itemId)).toContain(x.s.shirtM);
    expect((await search("kundan")).map((r) => r.detail).sort()).toEqual([
      "IJ0000123",
      "IJ0000124",
    ]);
    expect(await search("bangle")).toEqual([]); // other branch
    expect(await search("%")).toEqual([]);
    expect(await search("s")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("catalogue and stock permissions (TC-SEC-08, 09)", () => {
  it("only the owner can change an existing price; managers can create but not reprice", async () => {
    const x = await setup({ tax: "off" });
    await probe(c, x.w.managerA1, async (y) => {
      expect(
        await refused(y, "update retailos.product_variants set selling_price = 1 where id = $1", [
          x.s.shirtM,
        ]),
      ).toBe("FORBIDDEN");
    });
    await probe(c, x.w.cashierA1, async (y) => {
      const r = await y.query(
        "update retailos.product_variants set selling_price = 1 where id = $1",
        [x.s.shirtM],
      );
      expect(r.rowCount).toBe(0);
    });
    await asUser(c, x.w.ownerA, (y) =>
      y.query("update retailos.product_variants set selling_price = 1400 where id = $1", [
        x.s.shirtM,
      ]),
    );
    expect(
      (
        await c.query("select selling_price from retailos.product_variants where id = $1", [
          x.s.shirtM,
        ])
      ).rows[0].selling_price,
    ).toBe("1400.00");
    const a = await c.query(
      "select actor_user_id from retailos.audit_logs where entity_type = 'product_variant' and tenant_id = $1 order by id desc limit 1",
      [x.w.tenantA],
    );
    expect(a.rows[0].actor_user_id).toBe(x.w.ownerA);
  });

  it("cashiers and cross-tenant users cannot create catalogue records", async () => {
    const x = await setup({ tax: "off" });
    await probe(c, x.w.cashierA1, async (y) => {
      expect(
        await refused(y, "insert into retailos.brands (tenant_id, name) values ($1,'Evil')", [
          x.w.tenantA,
        ]),
      ).toMatch(/row-level security/i);
    });
    await probe(c, x.w.ownerB, async (y) => {
      expect(
        await refused(y, "insert into retailos.brands (tenant_id, name) values ($1,'Evil')", [
          x.w.tenantA,
        ]),
      ).toMatch(/row-level security/i);
      expect(
        (
          await y.query("select count(*)::int n from retailos.products where tenant_id = $1", [
            x.w.tenantA,
          ])
        ).rows[0].n,
      ).toBe(0);
    });
  });

  it("stock adjustment needs inventory.adjust, a valid reason, and is idempotent and audited", async () => {
    const x = await setup({ tax: "off" });
    const adj = (who: string, delta: number, reason: string, key = crypto.randomUUID()) =>
      rpc(c, who, "select retailos.inventory_adjust($1,$2,$3,$4,$5,$6)", [
        x.w.a1.id,
        x.s.jeans,
        delta,
        reason,
        "count",
        key,
      ]);
    expect(await adj(x.w.cashierA1, -1, "LOSS")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await adj(x.w.managerA1, -1, "WHATEVER")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await adj(x.w.managerA1, 0, "LOSS")).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await adj(x.w.managerA1, -11, "LOSS")).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_STOCK",
    });
    const key = crypto.randomUUID();
    const a = await adj(x.w.managerA1, -3, "DAMAGE", key);
    const b = await adj(x.w.managerA1, -3, "DAMAGE", key);
    expect(a.ok && a.data.balanceAfter).toBe(7);
    expect(b.ok && b.data.replayed).toBe(true);
    expect(
      (
        await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [
          x.s.jeans,
        ])
      ).rows[0].on_hand,
    ).toBe(7);
    expect(
      (
        await c.query(
          "select count(*)::int n from retailos.audit_logs where tenant_id = $1 and action = 'inventory.adjust'",
          [x.w.tenantA],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
