/**
 * Product and jewellery creation, barcode rules, and the first-tenant bootstrap script.
 * REAL PostgreSQL 17 (embedded) with a Supabase-compatible auth shim; not Supabase itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import fs from "node:fs";
import { expectFail, startDb, type TestDb } from "./harness";
import { buildWorld, createUser, type World } from "./fixtures";
import { cash, checkout, rpc, startDay } from "./shop";

let db: TestDb;
let c: Client;
beforeAll(async () => {
  db = await startDb();
  c = db.admin;
});
afterAll(async () => {
  await db?.stop();
});

const n = async (sql: string, p: unknown[] = []) => Number((await c.query(sql, p)).rows[0].n);
const key = () => crypto.randomUUID();

const variant = (over: Record<string, unknown> = {}) => ({ size: "M", colour: "Blue", pricePaise: 129900, openingStock: 5, ...over });
const createClothing = (w: World, who: string, o: { name?: string; style?: string; category?: string; hsn?: string | null; variants?: unknown[]; key?: string; branch?: string } = {}) =>
  rpc(c, who, "select retailos.catalog_create_clothing($1,$2,$3,$4,$5,$6::jsonb,$7)", [
    o.branch ?? w.a1.id, o.name ?? "Cotton Shirt", o.style ?? "SHIRT1", o.category ?? "Shirts", o.hsn ?? null,
    JSON.stringify(o.variants ?? [variant()]), o.key ?? key(),
  ]);
const createJewellery = (
  w: World, who: string,
  o: Partial<{ kind: string; name: string; category: string; tag: string | null; price: number; metal: string | null; purity: string | null; gross: number | null; net: number | null; barcode: string | null; key: string; branch: string }> = {},
) =>
  rpc(c, who, "select retailos.catalog_create_jewellery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,$11,$12)", [
    o.branch ?? w.a1.id, o.kind ?? "IMITATION", o.name ?? "Kundan Necklace", o.category ?? "Imitation", o.tag ?? null,
    o.price ?? 49900, o.metal ?? null, o.purity ?? null, o.gross ?? null, o.net ?? null, o.barcode ?? null, o.key ?? key(),
  ]);

describe("clothing products", () => {
  it("creates a style with variants, barcodes, prices and opening stock in one step", async () => {
    const w = await buildWorld(c);
    const r = await createClothing(w, w.ownerA, {
      variants: [variant(), variant({ size: "L", openingStock: 3, pricePaise: 139900 }), variant({ size: "XL", colour: "Red", openingStock: 0 })],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.variants).toHaveLength(3);
    const codes = r.data.variants.map((v: any) => v.barcode);
    expect(new Set(codes).size).toBe(3);
    for (const code of codes) expect(code).toMatch(/^AAA[A-Z0-9]*[0-9]{8}$/); // tenant code + 8-digit sequence
    expect(r.data.variants[0].sku).toBe("SHIRT1-M-BLUE");
    expect(await n("select count(*)::int n from retailos.product_variants where tenant_id = $1", [w.tenantA])).toBe(3);
    const stock = await c.query("select v.size_label s, b.on_hand h from retailos.inventory_balances b join retailos.product_variants v on v.id = b.variant_id where b.branch_id = $1 order by v.size_label", [w.a1.id]);
    expect(stock.rows).toEqual([{ s: "L", h: 3 }, { s: "M", h: 5 }]); // XL had no opening stock, so no balance row
    expect(await n("select count(*)::int n from retailos.inventory_movements where tenant_id = $1 and movement_type = 'OPENING'", [w.tenantA])).toBe(2);
    expect((await c.query("select selling_price p from retailos.product_variants where id = $1", [r.data.variants[1].variantId])).rows[0].p).toBe("1399.00");
    expect(await n("select count(*)::int n from retailos.audit_logs where tenant_id = $1 and action = 'catalog.create_clothing'", [w.tenantA])).toBe(1);
  });

  it("a single-variant product needs no size or colour (sensible defaults)", async () => {
    const w = await buildWorld(c);
    const r = await createClothing(w, w.ownerA, { variants: [{ pricePaise: 50000 }] });
    expect(r.ok && r.data.variants[0]).toMatchObject({ size: "FREE", colour: "DEFAULT" });
  });

  it("is idempotent: a repeated request creates nothing new", async () => {
    const w = await buildWorld(c);
    const k = key();
    const a = await createClothing(w, w.ownerA, { key: k });
    const b = await createClothing(w, w.ownerA, { key: k });
    expect(a.ok && b.ok && b.data.replayed).toBe(true);
    expect(b.ok && b.data.productId).toBe(a.ok && a.data.productId);
    expect(await n("select count(*)::int n from retailos.products where tenant_id = $1", [w.tenantA])).toBe(1);
    expect(await createClothing(w, w.ownerA, { key: k, name: "Different" })).toMatchObject({ ok: false, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("who may create: owner and manager yes; cashier, other branches' staff, other businesses no", async () => {
    const w = await buildWorld(c);
    expect((await createClothing(w, w.managerA1, { style: "MGR1" })).ok).toBe(true);
    for (const who of [w.cashierA1, w.cashierA2, w.cashierB1, w.ownerB, w.outsider, w.platformAdmin]) {
      expect(await createClothing(w, who, { style: `X${who.slice(0, 6)}` }), who).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await n("select count(*)::int n from retailos.products where tenant_id = $1", [w.tenantA])).toBe(1);
    const anon = await createClothing(w, null as never);
    expect(anon.ok === false && anon.code).toMatch(/permission denied/i);
  });

  it("refuses to add stock to a branch the person does not work in", async () => {
    const w = await buildWorld(c);
    // managerA1 belongs to A1 only: creating stock in A2 must be refused
    expect(await createClothing(w, w.managerA1, { branch: w.a2.id, style: "OTHER" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // ...but a product with NO opening stock needs no branch stock rights
    expect((await createClothing(w, w.managerA1, { style: "NOSTOCK", variants: [variant({ openingStock: 0 })] })).ok).toBe(true);
  });

  it("rejects invalid input and writes nothing", async () => {
    const w = await buildWorld(c);
    const bad: Array<Parameters<typeof createClothing>[2]> = [
      { name: "" }, { name: "x".repeat(121) }, { style: "" }, { hsn: "12" }, { hsn: "ABCD" }, { variants: [] },
      { variants: Array.from({ length: 101 }, (_, i) => variant({ size: `S${i}` })) },
      { variants: [variant({ pricePaise: -1 })] }, { variants: [variant({ pricePaise: 1.5 })] }, { variants: [variant({ pricePaise: "100" })] },
      { variants: [variant({ openingStock: -1 })] }, { variants: [variant({ openingStock: 1.5 })] },
      { variants: [variant({ size: "x".repeat(31) })] }, { variants: [variant({ price: 5 })] }, { variants: [variant({ barcode: "ab" })] },
      { category: "" },
    ];
    for (const o of bad) {
      expect(await createClothing(w, w.ownerA, o), JSON.stringify(o).slice(0, 80)).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    }
    expect(await n("select count(*)::int n from retailos.products where tenant_id = $1", [w.tenantA])).toBe(0);
    expect(await n("select count(*)::int n from retailos.categories where tenant_id = $1", [w.tenantA])).toBe(0);
  });

  it("enforces uniqueness and rolls the whole product back on a clash", async () => {
    const w = await buildWorld(c);
    expect((await createClothing(w, w.ownerA, { style: "S1", variants: [variant({ barcode: "ABCD1234", sku: "SKU-1" })] })).ok).toBe(true);
    const before = await n("select count(*)::int n from retailos.product_variants where tenant_id = $1", [w.tenantA]);
    expect(await createClothing(w, w.ownerA, { style: "S1" })).toMatchObject({ ok: false, code: "STYLE_CODE_TAKEN" });
    expect(await createClothing(w, w.ownerA, { style: "S2", variants: [variant({ size: "S" }), variant({ barcode: "ABCD1234" })] })).toMatchObject({ ok: false, code: "BARCODE_TAKEN" });
    expect(await createClothing(w, w.ownerA, { style: "S3", variants: [variant({ sku: "SKU-1" })] })).toMatchObject({ ok: false, code: "SKU_TAKEN" });
    expect(await createClothing(w, w.ownerA, { style: "S4", variants: [variant(), variant()] })).toMatchObject({ ok: false, code: "VARIANT_DUPLICATE" });
    // nothing from any failed attempt survived (no half-made product, stock or barcode)
    expect(await n("select count(*)::int n from retailos.product_variants where tenant_id = $1", [w.tenantA])).toBe(before);
    expect(await n("select count(*)::int n from retailos.products where tenant_id = $1 and style_code in ('S2','S3','S4')", [w.tenantA])).toBe(0);
    expect(await n("select count(*)::int n from retailos.inventory_movements where tenant_id = $1", [w.tenantA])).toBe(1); // only the one successful product's opening stock
  });

  it("lets two businesses use the same barcode, SKU and style code", async () => {
    const w = await buildWorld(c);
    const v = [variant({ barcode: "SAME1234", sku: "SAME-SKU" })];
    expect((await createClothing(w, w.ownerA, { style: "ST", variants: v })).ok).toBe(true);
    const other = await rpc(c, w.ownerB, "select retailos.catalog_create_clothing($1,'Shirt','ST','Shirts',null,$2::jsonb,$3)", [w.b1.id, JSON.stringify(v), key()]);
    expect(other.ok).toBe(true);
  });

  it("a created product can be found by exact barcode, sold once, and stock drops exactly once", async () => {
    const w = await buildWorld(c);
    await c.query("update retailos.tenant_settings set tax_enforced = false where tenant_id = $1", [w.tenantA]);
    const made = await createClothing(w, w.ownerA, { variants: [variant({ openingStock: 2 })] });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const { barcode, variantId } = made.data.variants[0];
    expect((await startDay(c, w.cashierA1, w.a1.id, w.a1.counterId)).ok).toBe(true);

    // exact match finds it; a near-miss does not
    expect((await rpc(c, w.cashierA1, "select retailos.resolve_barcode($1,$2)", [w.a1.id, barcode])).ok).toBe(true);
    expect(await rpc(c, w.cashierA1, "select retailos.resolve_barcode($1,$2)", [w.a1.id, barcode.slice(0, -1)])).toMatchObject({ ok: false, code: "BARCODE_NOT_FOUND" });

    const k = key();
    const sale = (kk: string) => checkout(c, w.cashierA1, { branch: w.a1.id, counter: w.a1.counterId, key: kk, lines: [{ itemId: variantId, quantity: 1 }], payments: [cash(129900)], expected: 129900 });
    const first = await sale(k);
    const again = await sale(k); // a double-click
    expect(first.ok && again.ok && again.data.replayed).toBe(true);
    expect((await c.query("select on_hand from retailos.inventory_balances where variant_id = $1", [variantId])).rows[0].on_hand).toBe(1); // 2 - 1, not 2 - 2
    expect(await n("select count(*)::int n from retailos.invoices where tenant_id = $1", [w.tenantA])).toBe(1);
  });

  it("the cashier cannot change the price of a product the owner created", async () => {
    const w = await buildWorld(c);
    const made = await createClothing(w, w.ownerA);
    const id = made.ok ? made.data.variants[0].variantId : "";
    const set = (who: string, price: number) => rpc(c, who, "update retailos.product_variants set selling_price = $2 where id = $1 returning 1 as ok", [id, price]);
    expect((await set(w.cashierA1, 1)).ok === true && false).toBe(false); // either refused or affects no row
    expect((await c.query("select selling_price p from retailos.product_variants where id = $1", [id])).rows[0].p).toBe("1299.00");
    expect(await set(w.managerA1, 1)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await set(w.ownerA, 1500)).ok).toBe(true);
    expect((await c.query("select selling_price p from retailos.product_variants where id = $1", [id])).rows[0].p).toBe("1500.00");
  });
});

describe("individually tagged jewellery", () => {
  it("creates an imitation piece with a generated unique tag and barcode, and logs it in the ledger", async () => {
    const w = await buildWorld(c);
    const r = await createJewellery(w, w.ownerA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.tagCode).toMatch(/^IJ[0-9]{7}$/);
    expect(r.data.barcode).toBe(r.data.tagCode);
    const item = (await c.query("select status, pricing_mode pm, tag_price p, kind from retailos.jewellery_items where id = $1", [r.data.itemId])).rows[0];
    expect(item).toEqual({ status: "IN_STOCK", pm: "FIXED_TAG", p: "499.00", kind: "IMITATION" });
    expect(await n("select count(*)::int n from retailos.inventory_movements where jewellery_item_id = $1 and movement_type = 'OPENING'", [r.data.itemId])).toBe(1);
    const second = await createJewellery(w, w.ownerA);
    expect(second.ok && second.data.tagCode).not.toBe(r.data.tagCode);
    // the same design name reuses the design
    expect(await n("select count(*)::int n from retailos.jewellery_designs where tenant_id = $1", [w.tenantA])).toBe(1);
  });

  it("creates a precious piece at a FIXED price, recording its weights, with no pricing formula involved", async () => {
    const w = await buildWorld(c);
    const r = await createJewellery(w, w.ownerA, { kind: "PRECIOUS", name: "Gold Chain 22K", category: "Gold", price: 4850000, metal: "gold", purity: "22k", gross: 10.5, net: 10 });
    expect(r.ok && r.data.tagCode).toMatch(/^GJ[0-9]{7}$/);
    const item = (await c.query("select pricing_mode pm, tag_price p, metal_type m, purity, gross_weight_g g, net_weight_g nw from retailos.jewellery_items where id = $1", [r.ok ? r.data.itemId : null])).rows[0];
    expect(item).toEqual({ pm: "FIXED_TAG", p: "48500.00", m: "GOLD", purity: "22K", g: "10.500", nw: "10.000" });
    // there is no rate or rule involved: no metal rate exists
    expect(await n("select count(*)::int n from retailos.metal_rates where tenant_id = $1", [w.tenantA])).toBe(0);
  });

  it("requires valid metal and weights for precious pieces, and rejects net weight above gross", async () => {
    const w = await buildWorld(c);
    const base = { kind: "PRECIOUS", name: "Ring", category: "Gold", price: 100000 };
    for (const o of [
      { ...base }, { ...base, metal: "gold", purity: "22k" }, { ...base, metal: "gold", purity: "22k", gross: 5, net: 6 },
      { ...base, metal: "gold", purity: "22k", gross: 0, net: 0 }, { ...base, metal: "g", purity: "22k", gross: 5, net: 5 },
      { ...base, metal: "gold", purity: "", gross: 5, net: 5 },
    ]) {
      expect(await createJewellery(w, w.ownerA, o), JSON.stringify(o)).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    }
    expect(await n("select count(*)::int n from retailos.jewellery_items where tenant_id = $1", [w.tenantA])).toBe(0);
  });

  it("enforces unique tags and barcodes across variants and jewellery within a business", async () => {
    const w = await buildWorld(c);
    expect((await createJewellery(w, w.ownerA, { tag: "TAG00001" })).ok).toBe(true);
    expect(await createJewellery(w, w.ownerA, { tag: "tag00001", name: "Other" })).toMatchObject({ ok: false, code: "TAG_CODE_TAKEN" });
    const made = await createClothing(w, w.ownerA, { variants: [variant({ barcode: "VARCODE1" })] });
    expect(made.ok).toBe(true);
    expect(await createJewellery(w, w.ownerA, { tag: "TAG00002", barcode: "VARCODE1" })).toMatchObject({ ok: false, code: "BARCODE_TAKEN" });
    expect(await createJewellery(w, w.ownerA, { tag: "VARCODE1" })).toMatchObject({ ok: false, code: "BARCODE_TAKEN" }); // the tag is the barcode by default
    expect(await n("select count(*)::int n from retailos.jewellery_items where tenant_id = $1 and tag_code = 'TAG00002'", [w.tenantA])).toBe(0);
  });

  it("rejects bad tags, kinds and prices", async () => {
    const w = await buildWorld(c);
    for (const o of [{ tag: "ab" }, { tag: "has space" }, { tag: "TOOLONG".repeat(5) }, { kind: "WOOD" }, { price: -1 }, { price: 1e12 }, { name: "" }]) {
      expect(await createJewellery(w, w.ownerA, o as never), JSON.stringify(o)).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    }
  });

  it("is idempotent and permission-controlled", async () => {
    const w = await buildWorld(c);
    const k = key();
    const a = await createJewellery(w, w.ownerA, { key: k, tag: "IDEM0001" });
    const b = await createJewellery(w, w.ownerA, { key: k, tag: "IDEM0001" });
    expect(a.ok && b.ok && b.data.replayed).toBe(true);
    expect(await n("select count(*)::int n from retailos.jewellery_items where tenant_id = $1", [w.tenantA])).toBe(1);
    for (const who of [w.cashierA1, w.cashierA2, w.ownerB, w.outsider]) {
      expect(await createJewellery(w, who, { tag: "NOPE0001" }), who).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await createJewellery(w, w.managerA1, { tag: "MGR00001", name: "Manager piece" })).ok).toBe(true);
    expect(await createJewellery(w, w.managerA1, { tag: "MGR00002", branch: w.a2.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("a created piece is sold exactly once, even when two cashiers scan it together", async () => {
    const w = await buildWorld(c);
    await c.query("update retailos.tenant_settings set tax_enforced = false where tenant_id = $1", [w.tenantA]);
    const made = await createJewellery(w, w.ownerA, { tag: "RACE0001", price: 100000 });
    expect(made.ok).toBe(true);
    await startDay(c, w.cashierA1, w.a1.id, w.a1.counterId);
    const clients = await Promise.all([db.connect(), db.connect(), db.connect()]);
    try {
      const rs = await Promise.all(clients.map((cl) =>
        checkout(cl, w.cashierA1, { branch: w.a1.id, counter: w.a1.counterId, lines: [{ itemId: made.ok ? made.data.itemId : "", quantity: 1 }], payments: [cash(100000)], expected: 100000 })));
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.filter((r) => !r.ok).map((r) => (r as any).code)).toEqual(["ITEM_ALREADY_SOLD", "ITEM_ALREADY_SOLD"]);
    } finally {
      await Promise.all(clients.map((cl) => cl.end()));
    }
  });

  it("updating a piece: the price needs product.price_edit and a sold piece is locked", async () => {
    const w = await buildWorld(c);
    await c.query("update retailos.tenant_settings set tax_enforced = false where tenant_id = $1", [w.tenantA]);
    const made = await createJewellery(w, w.ownerA, { tag: "UPD00001" });
    const id = made.ok ? made.data.itemId : "";
    const upd = (who: string, price: number | null, active: boolean | null) => rpc(c, who, "select retailos.catalog_update_jewellery($1,$2,$3)", [id, price, active]);
    expect(await upd(w.cashierA1, 1000, null)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await upd(w.managerA1, 1000, null)).toMatchObject({ ok: false, code: "FORBIDDEN" }); // no price_edit
    expect((await upd(w.managerA1, null, false)).ok).toBe(true);                                  // availability only
    expect(await upd(w.ownerB, 5, null)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await upd(w.ownerA, 60000, true)).ok).toBe(true);
    expect((await c.query("select tag_price p, is_active a from retailos.jewellery_items where id = $1", [id])).rows[0]).toEqual({ p: "600.00", a: true });
    await startDay(c, w.cashierA1, w.a1.id, w.a1.counterId);
    expect((await checkout(c, w.cashierA1, { branch: w.a1.id, counter: w.a1.counterId, lines: [{ itemId: id, quantity: 1 }], payments: [cash(60000)], expected: 60000 })).ok).toBe(true);
    expect(await upd(w.ownerA, 1, null)).toMatchObject({ ok: false, code: "ITEM_SOLD_LOCKED" });
  });
});

describe("first-tenant bootstrap script", () => {
  const sql = fs.readFileSync("supabase/retailos/bootstrap/first-tenant.sql", "utf8");
  const fill = (email: string, state = "XX") =>
    sql.replace("REPLACE_WITH_OWNER_EMAIL", email).replace("REPLACE_WITH_2_CHARACTER_STATE_CODE", state);

  it("refuses to run with the placeholder values still in place", async () => {
    expect(await expectFail(() => c.query(sql))).toMatch(/Edit the values/);
  });

  it("stops if the owner's login does not exist, or the state code is not two characters", async () => {
    expect(await expectFail(() => c.query(fill("nobody@nowhere.test")))).toMatch(/No login found/);
    await createUser(c, "boot.owner@test.local");
    expect(await expectFail(() => c.query(fill("boot.owner@test.local", "ABC")))).toMatch(/exactly 2 characters/);
  });

  it("creates the business, branch, counter and owner; sets no tax, GSTIN or rate; is safe to re-run", async () => {
    const owner = await createUser(c, "boot2.owner@test.local");
    // the owner has no access before the script
    expect(await rpc(c, owner, "select retailos.pos_get_session('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000')", [])).toMatchObject({ ok: false });
    await c.query(fill("boot2.owner@test.local"));
    await c.query(fill("boot2.owner@test.local")); // second run
    expect(await n("select count(*)::int n from retailos.tenants where code = 'NRC'")).toBe(1);
    expect(await n("select count(*)::int n from retailos.branches b join retailos.tenants t on t.id = b.tenant_id where t.code = 'NRC'")).toBe(1);
    expect(await n("select count(*)::int n from retailos.counters co join retailos.tenants t on t.id = co.tenant_id where t.code = 'NRC'")).toBe(1);
    const t = (await c.query("select id, gstin, state_code from retailos.tenants where code = 'NRC'")).rows[0];
    expect(t.gstin).toBeNull();
    expect(await n("select count(*)::int n from retailos.tax_rates where tenant_id = $1", [t.id])).toBe(0);
    expect(await n("select count(*)::int n from retailos.tax_classes where tenant_id = $1", [t.id])).toBe(0);
    // tax stays in its safe state: billing is blocked until the owner chooses
    expect((await c.query("select tax_enforced, prices_include_tax_clothing pc from retailos.tenant_settings where tenant_id = $1", [t.id])).rows[0]).toEqual({ tax_enforced: true, pc: null });

    // the owner can now work, and exactly as the owner
    const branch = (await c.query("select b.id, co.id counter from retailos.branches b join retailos.counters co on co.branch_id = b.id join retailos.tenants t on t.id = b.tenant_id where t.code = 'NRC'")).rows[0];
    const made = await rpc(c, owner, "select retailos.catalog_create_clothing($1,'Test','T1','Tops',null,$2::jsonb,$3)", [branch.id, JSON.stringify([variant()]), key()]);
    expect(made.ok).toBe(true);
    expect((await startDay(c, owner, branch.id, branch.counter)).ok).toBe(true);
    // ...and billing is blocked until tax is decided: the safe default, not a silent zero-tax bill
    const blocked = await checkout(c, owner, { branch: branch.id, counter: branch.counter, lines: [{ itemId: made.ok ? made.data.variants[0].variantId : "", quantity: 1 }], payments: [cash(129900)], expected: 129900 });
    expect(blocked).toMatchObject({ ok: false, code: "TAX_NOT_CONFIGURED" });
  });
});
