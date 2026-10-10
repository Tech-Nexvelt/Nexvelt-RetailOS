import type { Client } from "pg";
import { asUser, type Claims } from "./harness";
import type { World } from "./fixtures";

/**
 * Catalogue fixtures for tenant A.
 *
 * IMPORTANT: the 10% rate below is a TEST FIXTURE chosen to make the arithmetic easy to verify. It is
 * not a GST rate and nothing in the product uses it. Real rates are configured by the client's owner.
 */
export const TEST_RATE_PCT = 10;

export interface Shop {
  taxClass: string;
  clothingCat: string;
  imitationCat: string;
  preciousCat: string;
  shirtM: string; // ₹1,299.00, stock 5 at A1
  shirtL: string; // ₹1,299.00, stock 1 at A1
  jeans: string; // ₹1,899.00, stock 10 at A1
  pennyTee: string; // ₹0.05, stock 10 (tax rounding edge)
  necklace1: string; // imitation ₹499.00, IN_STOCK at A1
  necklace2: string; // imitation ₹499.00, SOLD at A1
  earrings: string; // imitation ₹299.00, QC_HOLD at A1
  chain: string; // precious FIXED_TAG ₹48,500.00, IN_STOCK at A1
  ring: string; // precious METAL_RATE (no rule configured), IN_STOCK at A1
  bangleA2: string; // imitation, IN_STOCK at A2
  codes: Record<string, string>;
}

async function one(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  return (await c.query(sql, params)).rows[0].id as string;
}

export async function buildShop(c: Client, w: World): Promise<Shop> {
  const t = w.tenantA;
  const taxClass = await one(
    c,
    "insert into retailos.tax_classes (tenant_id, code, name) values ($1,'TESTCLASS','Test class') returning id",
    [t],
  );
  const clothingCat = await one(
    c,
    "insert into retailos.categories (tenant_id, name, product_kind, tax_class_id) values ($1,'Shirts','CLOTHING',$2) returning id",
    [t, taxClass],
  );
  const imitationCat = await one(
    c,
    "insert into retailos.categories (tenant_id, name, product_kind, tax_class_id) values ($1,'Imitation','IMITATION_JEWELLERY',$2) returning id",
    [t, taxClass],
  );
  const preciousCat = await one(
    c,
    "insert into retailos.categories (tenant_id, name, product_kind, tax_class_id) values ($1,'Gold','PRECIOUS_JEWELLERY',$2) returning id",
    [t, taxClass],
  );

  const product = (name: string, style: string) =>
    one(
      c,
      "insert into retailos.products (tenant_id, category_id, style_code, name) values ($1,$2,$3,$4) returning id",
      [t, clothingCat, style, name],
    );
  const variant = (p: string, sku: string, size: string, colour: string, price: string) =>
    one(
      c,
      "insert into retailos.product_variants (tenant_id, product_id, sku, size_label, colour_label, selling_price) values ($1,$2,$3,$4,$5,$6) returning id",
      [t, p, sku, size, colour, price],
    );

  const shirtP = await product("Cotton Shirt", "SHIRT1");
  const shirtM = await variant(shirtP, "SHIRT1-M-BLUE", "M", "Blue", "1299.00");
  const shirtL = await variant(shirtP, "SHIRT1-L-BLUE", "L", "Blue", "1299.00");
  const jeansP = await product("Slim Jeans", "JEANS1");
  const jeans = await variant(jeansP, "JEANS1-32-INDIGO", "32", "Indigo", "1899.00");
  const pennyP = await product("Penny Tee", "PENNY1");
  const pennyTee = await variant(pennyP, "PENNY1-FREE", "FREE", "DEFAULT", "0.05");

  const stock = async (variantId: string, qty: number) =>
    c.query(
      "select retailos_private.apply_variant_movement($1,$2,$3,$4,'OPENING','TEST',null,null,null,current_date)",
      [t, w.a1.id, variantId, qty],
    );
  await stock(shirtM, 5);
  await stock(shirtL, 1);
  await stock(jeans, 10);
  await stock(pennyTee, 10);

  const impDesign = await one(
    c,
    "insert into retailos.jewellery_designs (tenant_id, kind, category_id, design_code, name) values ($1,'IMITATION',$2,'KUNDAN','Kundan Necklace') returning id",
    [t, imitationCat],
  );
  const impDesign2 = await one(
    c,
    "insert into retailos.jewellery_designs (tenant_id, kind, category_id, design_code, name) values ($1,'IMITATION',$2,'JHUMKA','Jhumka Earrings') returning id",
    [t, imitationCat],
  );
  const goldDesign = await one(
    c,
    "insert into retailos.jewellery_designs (tenant_id, kind, category_id, design_code, name) values ($1,'PRECIOUS',$2,'CHAIN22','Gold Chain 22K') returning id",
    [t, preciousCat],
  );

  const imit = (branch: string, design: string, tag: string, price: string, status = "IN_STOCK") =>
    one(
      c,
      "insert into retailos.jewellery_items (tenant_id, branch_id, design_id, kind, tag_code, status, tag_price) values ($1,$2,$3,'IMITATION',$4,$5,$6) returning id",
      [t, branch, design, tag, status, price],
    );
  const necklace1 = await imit(w.a1.id, impDesign, "IJ0000123", "499.00");
  const necklace2 = await imit(w.a1.id, impDesign, "IJ0000124", "499.00", "SOLD");
  const earrings = await imit(w.a1.id, impDesign2, "IJ0000125", "299.00", "QC_HOLD");
  const bangleA2 = await imit(w.a2.id, impDesign2, "IJ0000999", "199.00");
  const chain = await one(
    c,
    `insert into retailos.jewellery_items (tenant_id, branch_id, design_id, kind, tag_code, pricing_mode, tag_price, metal_type, purity, gross_weight_g, net_weight_g)
     values ($1,$2,$3,'PRECIOUS','GJ0000045','FIXED_TAG',48500.00,'GOLD','22K',10.500,10.000) returning id`,
    [t, w.a1.id, goldDesign],
  );
  const ring = await one(
    c,
    `insert into retailos.jewellery_items (tenant_id, branch_id, design_id, kind, tag_code, pricing_mode, metal_type, purity, gross_weight_g, net_weight_g)
     values ($1,$2,$3,'PRECIOUS','GJ0000046','METAL_RATE','GOLD','22K',5.250,5.000) returning id`,
    [t, w.a1.id, goldDesign],
  );

  const codes: Record<string, string> = {
    SHIRT_M: "NR00000001",
    SHIRT_L: "NR00000002",
    JEANS: "NR00000012",
    PENNY: "NR00000020",
    NECKLACE1: "IJ0000123",
    NECKLACE2: "IJ0000124",
    EARRINGS: "IJ0000125",
    BANGLE_A2: "IJ0000999",
    CHAIN: "GJ0000045",
    RING: "GJ0000046",
  };
  const targets: Record<string, [string, string]> = {
    SHIRT_M: ["VARIANT", shirtM],
    SHIRT_L: ["VARIANT", shirtL],
    JEANS: ["VARIANT", jeans],
    PENNY: ["VARIANT", pennyTee],
    NECKLACE1: ["JEWELLERY_ITEM", necklace1],
    NECKLACE2: ["JEWELLERY_ITEM", necklace2],
    EARRINGS: ["JEWELLERY_ITEM", earrings],
    BANGLE_A2: ["JEWELLERY_ITEM", bangleA2],
    CHAIN: ["JEWELLERY_ITEM", chain],
    RING: ["JEWELLERY_ITEM", ring],
  };
  for (const [k, [type, id]] of Object.entries(targets)) {
    await c.query(
      `insert into retailos.barcode_aliases (tenant_id, code, target_type, variant_id, jewellery_item_id) values ($1,$2,$3,$4,$5)`,
      [t, codes[k], type, type === "VARIANT" ? id : null, type === "JEWELLERY_ITEM" ? id : null],
    );
  }
  return {
    taxClass,
    clothingCat,
    imitationCat,
    preciousCat,
    shirtM,
    shirtL,
    jeans,
    pennyTee,
    necklace1,
    necklace2,
    earrings,
    chain,
    ring,
    bangleA2,
    codes,
  };
}

/** Configure tax for tenant A the way an owner would. The rate is a TEST fixture (see top of file). */
export async function configureTax(
  c: Client,
  w: World,
  s: Shop,
  mode: "exclusive" | "inclusive" | "off",
) {
  if (mode === "off") {
    await c.query("update retailos.tenant_settings set tax_enforced = false where tenant_id = $1", [
      w.tenantA,
    ]);
    return;
  }
  await c.query(
    "update retailos.tenant_settings set tax_enforced = true, prices_include_tax_clothing = $2, prices_include_tax_jewellery = $2 where tenant_id = $1",
    [w.tenantA, mode === "inclusive"],
  );
  await c.query("delete from retailos.tax_rates where tenant_id = $1", [w.tenantA]).catch(() => {});
  const has = await c.query(
    "select 1 from retailos.tax_rates where tenant_id = $1 and tax_class_id = $2",
    [w.tenantA, s.taxClass],
  );
  if (has.rowCount === 0) {
    await c.query(
      "insert into retailos.tax_rates (tenant_id, tax_class_id, effective_from, gst_rate_pct) values ($1,$2,'2000-01-01',$3)",
      [w.tenantA, s.taxClass, TEST_RATE_PCT],
    );
  }
}

export type Line = {
  itemId: string;
  quantity: number;
  discountPaise?: number;
  discountReason?: string;
};
export type Pay = {
  method: string;
  amountPaise: number;
  tenderedPaise?: number;
  confirmedReceived?: boolean;
  reference?: string;
};

export interface RpcOk<T = any> {
  ok: true;
  data: T;
}
export interface RpcFail {
  ok: false;
  code: string;
  detail?: any;
  /** present only so callers can read it after asserting ok; always undefined on failure */ data?: any;
}

/** Call a function as a signed-in user. Business errors come back as { ok:false, code }. */
export async function rpc<T = any>(
  c: Client,
  userId: string | null,
  sql: string,
  params: unknown[],
  claims?: Claims,
): Promise<RpcOk<T> | RpcFail> {
  try {
    const data = await asUser(c, userId, async (x) => (await x.query(sql, params)).rows[0], claims);
    const first = data ? (Object.values(data)[0] as T) : (null as T);
    return { ok: true, data: first };
  } catch (e) {
    const err = e as { message: string; detail?: string };
    let detail: any;
    try {
      detail = err.detail ? JSON.parse(err.detail) : undefined;
    } catch {
      detail = undefined;
    }
    return { ok: false, code: err.message, detail };
  }
}

export const quote = (c: Client, u: string | null, branch: string, lines: unknown[]) =>
  rpc(c, u, "select retailos.pos_quote_cart($1, $2::jsonb)", [branch, JSON.stringify(lines)]);

export const startDay = (
  c: Client,
  u: string | null,
  branch: string,
  counter: string,
  floatPaise = 100000,
) => rpc(c, u, "select retailos.pos_start_day($1,$2,$3)", [branch, counter, floatPaise]);

export const checkout = (
  c: Client,
  u: string | null,
  a: {
    branch: string;
    counter: string;
    key?: string;
    lines: unknown[];
    payments: unknown[];
    expected: number;
    customer?: unknown;
  },
) =>
  rpc(c, u, "select retailos.pos_checkout($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb)", [
    a.branch,
    a.counter,
    a.key ?? crypto.randomUUID(),
    JSON.stringify(a.lines),
    JSON.stringify(a.payments),
    a.expected,
    a.customer === undefined ? null : JSON.stringify(a.customer),
  ]);

export const cash = (amountPaise: number, tenderedPaise?: number): Pay => ({
  method: "CASH",
  amountPaise,
  tenderedPaise,
});
