// Generates supabase/retailos/demo/demo-catalogue.sql (and docs/RETAILOS_DEMO_BARCODES.md) from the table below.
//   node scripts/gen-demo-catalogue.mjs
// The SQL calls the app's own functions (catalog_create_clothing / catalog_create_jewellery) as the tenant owner, so barcodes, stock
// movements, categories and audit entries are created exactly as the app creates them. Deterministic idempotency keys make it safe to
// run twice (the second run only reports "replayed"). It writes demo rows into the live tables: run it only on a project meant for the demo.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

/** EAN-13 with a correct check digit, so the printed barcode scans as a real EAN-13. */
const ean13 = (n) => {
  const base = "890123" + String(n).padStart(6, "0");
  const sum = [...base].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
};
let seq = 0;

// price in rupees, stock in pieces
const CLOTHING = [
  { style: "MCS101", name: "Men's Cotton Shirt", category: "Shirts", hsn: "6205", variants: [["M", "Sky Blue", 1299, 8], ["L", "Sky Blue", 1299, 10], ["XL", "Sky Blue", 1299, 6], ["M", "White", 1299, 7], ["L", "White", 1299, 9], ["XL", "White", 1299, 5]] },
  { style: "MFS102", name: "Men's Formal Shirt", category: "Shirts", hsn: "6205", variants: [["M", "Light Grey", 1599, 6], ["L", "Light Grey", 1599, 8], ["XL", "Light Grey", 1599, 4]] },
  { style: "JNS201", name: "Slim Fit Jeans", category: "Jeans", hsn: "6203", variants: [["30", "Indigo", 1899, 6], ["32", "Indigo", 1899, 9], ["34", "Indigo", 1899, 7], ["36", "Indigo", 1899, 4], ["32", "Black", 1999, 5]] },
  { style: "KRT301", name: "Printed Cotton Kurti", category: "Kurtis", hsn: "6204", variants: [["S", "Maroon", 899, 6], ["M", "Maroon", 899, 10], ["L", "Maroon", 899, 8], ["M", "Teal", 899, 7], ["L", "Teal", 899, 6]] },
  { style: "ANK302", name: "Anarkali Kurti Set", category: "Kurtis", hsn: "6204", variants: [["M", "Mustard", 2499, 4], ["L", "Mustard", 2499, 5], ["XL", "Mustard", 2499, 3]] },
  { style: "SAR401", name: "Silk Blend Saree", category: "Sarees", hsn: "5007", variants: [["", "Royal Red", 3499, 5], ["", "Bottle Green", 3499, 4], ["", "Peacock Blue", 3799, 3]] },
  { style: "PLZ601", name: "Cotton Palazzo", category: "Bottoms", hsn: "6204", variants: [["M", "Black", 749, 9], ["L", "Black", 749, 9], ["M", "Navy", 749, 6]] },
  { style: "KID501", name: "Kids Graphic T-Shirt", category: "Kids Wear", hsn: "6109", variants: [["4Y", "Yellow", 499, 8], ["6Y", "Yellow", 499, 8], ["8Y", "Yellow", 499, 6], ["6Y", "Red", 499, 7]] },
];

// kind: IMITATION | PRECIOUS. Prices are fixed tag prices (demo values, not derived from a metal rate).
const JEWELLERY = [
  ...[
    ["Kundan Necklace Set", "Necklaces", 499],
    ["Jhumka Earrings", "Earrings", 299],
    ["Oxidised Bangles Set", "Bangles", 349],
    ["Pearl Choker", "Necklaces", 799],
    ["Temple Haaram", "Necklaces", 1299],
    ["Meenakari Maang Tikka", "Head Jewellery", 399],
    ["Payal Anklet Pair", "Anklets", 259],
  ].flatMap(([name, category, price]) => [0, 1].map((k) => ({ kind: "IMITATION", name, category, price, copy: k }))),
  { kind: "PRECIOUS", name: "Gold Chain 22K", category: "Gold Chains", price: 58500, metal: "GOLD", purity: "22K", gross: 8.2, net: 8.15, hsn: "7113" },
  { kind: "PRECIOUS", name: "Gold Ring 22K", category: "Gold Rings", price: 28000, metal: "GOLD", purity: "22K", gross: 3.5, net: 3.42, hsn: "7113" },
  { kind: "PRECIOUS", name: "Gold Stud Earrings 22K", category: "Gold Earrings", price: 17500, metal: "GOLD", purity: "22K", gross: 2.1, net: 2.05, hsn: "7113", copy: 0 },
  { kind: "PRECIOUS", name: "Gold Stud Earrings 22K", category: "Gold Earrings", price: 17500, metal: "GOLD", purity: "22K", gross: 2.1, net: 2.05, hsn: "7113", copy: 1 },
  { kind: "PRECIOUS", name: "Gold Bangle 22K", category: "Gold Bangles", price: 98000, metal: "GOLD", purity: "22K", gross: 12.4, net: 12.3, hsn: "7113" },
  { kind: "PRECIOUS", name: "Gold Pendant 22K", category: "Gold Pendants", price: 23500, metal: "GOLD", purity: "22K", gross: 2.9, net: 2.85, hsn: "7113" },
  { kind: "PRECIOUS", name: "Silver Anklet 925", category: "Silver", price: 6200, metal: "SILVER", purity: "925", gross: 45.0, net: 44.5, hsn: "7113" },
  { kind: "PRECIOUS", name: "Silver Pooja Plate 925", category: "Silver", price: 14500, metal: "SILVER", purity: "925", gross: 120.0, net: 118.0, hsn: "7113" },
];

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const paise = (r) => Math.round(r * 100);
const sheet = { clothing: [], jewellery: [] };

const clothingCalls = CLOTHING.map((p) => {
  const variants = p.variants.map(([size, colour, price, stock]) => {
    const barcode = ean13(++seq);
    sheet.clothing.push({ name: p.name, size: size || "Free size", colour, price, stock, barcode });
    return `{"size":${JSON.stringify(size)},"colour":${JSON.stringify(colour)},"pricePaise":${paise(price)},"openingStock":${stock},"barcode":"${barcode}"}`;
  });
  return `  perform pg_temp.seed_clothing(v_branch, ${q(p.name)}, ${q(p.style)}, ${q(p.category)}, ${q(p.hsn)}, ${q("[" + variants.join(",") + "]")}::jsonb);`;
});

let imi = 0;
let pre = 0;
const jewelCalls = JEWELLERY.map((j) => {
  const tag = j.kind === "IMITATION" ? `IJ9${String(++imi).padStart(6, "0")}` : `GJ9${String(++pre).padStart(6, "0")}`;
  const barcode = ean13(++seq);
  sheet.jewellery.push({ name: j.name, kind: j.kind === "IMITATION" ? "Imitation" : `${j.metal} ${j.purity}`, price: j.price, tag, barcode, weight: j.gross ? `${j.gross} g` : "" });
  return `  perform pg_temp.seed_jewellery(v_branch, ${q(j.kind)}, ${q(j.name)}, ${q(j.category)}, ${q(tag)}, ${paise(j.price)}, ${j.metal ? q(j.metal) : "null"}, ${j.purity ? q(j.purity) : "null"}, ${j.gross ?? "null"}, ${j.net ?? "null"}, ${j.hsn ? q(j.hsn) : "null"}, ${q(barcode)});`;
});

const units = CLOTHING.flatMap((p) => p.variants).reduce((n, v) => n + v[3], 0);
const value = CLOTHING.flatMap((p) => p.variants).reduce((n, v) => n + v[2] * v[3], 0) + JEWELLERY.reduce((n, j) => n + j.price, 0);

const sql = `-- NexVelt RetailOS: DEMO CATALOGUE for NR Collections (clothing + jewellery).
-- GENERATED by scripts/gen-demo-catalogue.mjs. Not part of the approved migration manifest; it only calls the app's own functions.
--
-- WHAT IT DOES
--   Creates ${CLOTHING.length} clothing styles (${CLOTHING.reduce((n, p) => n + p.variants.length, 0)} size/colour variants, ${units} pieces in stock) and ${JEWELLERY.length} individually tagged jewellery pieces
--   (${JEWELLERY.filter((j) => j.kind === "IMITATION").length} imitation, ${JEWELLERY.filter((j) => j.kind === "PRECIOUS").length} gold/silver) with fixed tag prices. Every barcode is a valid EAN-13 you can print and scan.
--   Total stock value at selling price: Rs ${value.toLocaleString("en-IN")}. Prices are illustrative demo values, not derived from a metal rate.
-- HOW
--   It acts as the shop OWNER (the active tenant_owner), so permissions, barcodes, categories, stock movements and the audit log are
--   handled by the same database functions the app uses. Nothing is inserted into tables directly.
-- SAFE TO RUN TWICE
--   Deterministic idempotency keys: a second run changes nothing (the functions report the original result as "replayed").
-- WHERE
--   Run in the Supabase SQL editor, as postgres, ONCE, on the project you will demo. It writes real rows (visible in the app).
--   If you change a name, price or stock here AFTER running, use the app's Products screen instead, not this script.
-- REMOVING IT
--   Bills are immutable, so sold demo items cannot be deleted. Items nobody has sold can be switched off in Products > open item > Switch off.
-- The last statement returns a summary; the editor shows only the last result.

begin;

-- act as the owner, exactly as a signed-in owner session would
select set_config('request.jwt.claims',
  json_build_object('sub', (select m.user_id from retailos.tenant_memberships m join retailos.roles r on r.id = m.role_id
                             where r.key = 'tenant_owner' and m.status = 'ACTIVE' order by m.created_at limit 1),
                    'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;

create or replace function pg_temp.seed_clothing(p_branch uuid, p_name text, p_style text, p_cat text, p_hsn text, p_variants jsonb) returns void
language plpgsql as $f$
begin
  perform retailos.catalog_create_clothing(p_branch, p_name, p_style, p_cat, p_hsn, p_variants, md5('nrc-demo-clothing|' || p_style)::uuid);
end;
$f$;

create or replace function pg_temp.seed_jewellery(p_branch uuid, p_kind text, p_name text, p_cat text, p_tag text, p_price bigint,
                                                  p_metal text, p_purity text, p_gross numeric, p_net numeric, p_hsn text, p_barcode text) returns void
language plpgsql as $f$
begin
  perform retailos.catalog_create_jewellery(p_branch, p_kind, p_name, p_cat, p_tag, p_price, p_metal, p_purity, p_gross, p_net, p_hsn, p_barcode,
                                            md5('nrc-demo-jewellery|' || p_tag)::uuid);
end;
$f$;

do $seed$
declare
  v_branch uuid;
begin
  select b.id into v_branch from retailos.branches b where b.code = 'MAIN' order by b.created_at limit 1;
  if v_branch is null then raise exception 'No MAIN branch found: run the tenant bootstrap first.'; end if;
  if (select auth.uid()) is null then raise exception 'No active owner found: run the tenant bootstrap first.'; end if;

  -- clothing
${clothingCalls.join("\n")}

  -- jewellery
${jewelCalls.join("\n")}
end
$seed$;

reset role;
commit;

-- summary (read-only)
select
  (select count(*) from retailos.products)                                              as clothing_styles,
  (select count(*) from retailos.product_variants)                                      as clothing_variants,
  (select coalesce(sum(on_hand), 0) from retailos.inventory_balances)                   as clothing_pieces_in_stock,
  (select count(*) from retailos.jewellery_items where status = 'IN_STOCK')             as jewellery_pieces_in_stock,
  (select count(*) from retailos.barcode_aliases)                                       as barcodes,
  (select count(*) from retailos.categories)                                            as categories;
`;

mkdirSync(join(root, "supabase", "retailos", "demo"), { recursive: true });
writeFileSync(join(root, "supabase", "retailos", "demo", "demo-catalogue.sql"), sql);

const md = `# NR Collections demo catalogue: barcodes to scan

Created by \`supabase/retailos/demo/demo-catalogue.sql\` (generated by \`node scripts/gen-demo-catalogue.mjs\`). Every code is a valid **EAN-13**: print this page, or show the code on a screen, and scan it on the Billing screen or with the phone scanner. Jewellery tags are Code 128-compatible (letters and digits); the EAN-13 barcode is the primary scan code for each piece.
Prices are illustrative demo values. Stock is the opening stock the script creates.

## Clothing
| Item | Size | Colour | Price | Stock | Barcode |
|---|---|---|---:|---:|---|
${sheet.clothing.map((r) => `| ${r.name} | ${r.size} | ${r.colour} | Rs ${r.price.toLocaleString("en-IN")} | ${r.stock} | \`${r.barcode}\` |`).join("\n")}

## Jewellery (one piece per tag)
| Piece | Type | Weight | Price | Tag | Barcode |
|---|---|---|---:|---|---|
${sheet.jewellery.map((r) => `| ${r.name} | ${r.kind} | ${r.weight} | Rs ${r.price.toLocaleString("en-IN")} | \`${r.tag}\` | \`${r.barcode}\` |`).join("\n")}

A suggested 3-minute demo: scan two shirts and a kurti, add the gold chain, pay part by UPI and part by cash, show the receipt, then open Reports.
`;
writeFileSync(join(root, "docs", "RETAILOS_DEMO_BARCODES.md"), md);
console.log(`Wrote demo-catalogue.sql: ${CLOTHING.length} styles, ${CLOTHING.reduce((n, p) => n + p.variants.length, 0)} variants, ${units} pieces, ${JEWELLERY.length} jewellery pieces.`);
