import "server-only";
import type { CatalogRow } from "@/domain/catalog";
import { getEngine } from "../billing/store";
import { toPaise } from "./sales";
import type { AppSession } from "./session";

/** Substring match for the management search. (Billing never does this for barcodes.) */
const matches = (r: CatalogRow, q: string) =>
  !q || [r.name, r.detail, r.barcode].some((v) => v.toLowerCase().includes(q.toLowerCase()));

export async function listCatalog(s: AppSession, query: string): Promise<CatalogRow[]> {
  const q = query.trim().slice(0, 60);
  if (s.mode === "demo") {
    return getEngine()
      .listCatalog()
      .map<CatalogRow>((i) => ({
        kind: i.kind === "CLOTHING" ? "VARIANT" : "JEWELLERY",
        id: i.id,
        name: i.name,
        detail: i.detail,
        barcode: i.code,
        pricePaise: i.unitPricePaise,
        stock: i.kind === "CLOTHING" ? (i.stock ?? 0) : null,
        status: !i.active ? "Switched off" : i.kind === "CLOTHING" ? ((i.stock ?? 0) > 0 ? "In stock" : "Out of stock") : i.status === "IN_STOCK" ? "In stock" : i.status === "SOLD" ? "Sold" : "On hold",
        active: i.active,
      }))
      .filter((r) => matches(r, q));
  }
  const db = s.client!;
  const [products, variants, items, designs, codes, balances] = await Promise.all([
    db.from("products").select("id, name").limit(2000),
    db.from("product_variants").select("id, product_id, size_label, colour_label, selling_price, is_active").limit(5000),
    db.from("jewellery_items").select("id, design_id, tag_code, tag_price, status, is_active").eq("branch_id", s.branchId).limit(5000),
    db.from("jewellery_designs").select("id, name").limit(2000),
    db.from("barcode_aliases").select("code, variant_id, jewellery_item_id").eq("is_primary", true).eq("is_active", true).limit(10000),
    db.from("inventory_balances").select("variant_id, on_hand").eq("branch_id", s.branchId).limit(5000),
  ]);
  for (const r of [products, variants, items, designs, codes]) if (r.error) throw new Error("Could not load products.");
  // balances need inventory.view; without it stock simply shows as unknown
  const stockOf = new Map((balances.data ?? []).map((b) => [b.variant_id as string, b.on_hand as number]));
  const stockKnown = !balances.error;
  const name = new Map((products.data ?? []).map((p) => [p.id as string, p.name as string]));
  const dname = new Map((designs.data ?? []).map((d) => [d.id as string, d.name as string]));
  const code = new Map<string, string>();
  for (const c of codes.data ?? []) code.set((c.variant_id ?? c.jewellery_item_id) as string, c.code as string);

  const rows: CatalogRow[] = [
    ...(variants.data ?? []).map<CatalogRow>((v) => {
      const stock = stockKnown ? (stockOf.get(v.id as string) ?? 0) : null;
      return {
        kind: "VARIANT",
        id: v.id as string,
        name: name.get(v.product_id as string) ?? "(unnamed)",
        detail: `${v.size_label} / ${v.colour_label}`,
        barcode: code.get(v.id as string) ?? "",
        pricePaise: toPaise(v.selling_price),
        stock,
        status: !v.is_active ? "Switched off" : stock === null ? "—" : stock > 0 ? "In stock" : "Out of stock",
        active: Boolean(v.is_active),
      };
    }),
    ...(items.data ?? []).map<CatalogRow>((i) => ({
      kind: "JEWELLERY",
      id: i.id as string,
      name: dname.get(i.design_id as string) ?? "(unnamed)",
      detail: i.tag_code as string,
      barcode: code.get(i.id as string) ?? "",
      pricePaise: toPaise(i.tag_price),
      stock: null,
      status: !i.is_active ? "Switched off" : i.status === "IN_STOCK" ? "In stock" : i.status === "SOLD" ? "Sold" : i.status === "QC_HOLD" ? "On hold" : String(i.status),
      active: Boolean(i.is_active),
    })),
  ];
  return rows.filter((r) => matches(r, q)).sort((a, b) => a.name.localeCompare(b.name) || a.detail.localeCompare(b.detail));
}

export async function getCatalogRow(s: AppSession, id: string): Promise<CatalogRow | null> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return null;
  const rows = await listCatalog(s, "");
  return rows.find((r) => r.id === id) ?? null;
}
