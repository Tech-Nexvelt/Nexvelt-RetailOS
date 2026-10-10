"use server";

import { z } from "zod";
import { catalogMessage, type CatalogResult } from "@/domain/catalog";
import { dbCode } from "./db-errors";
import { requireActionSession, type AppSession } from "./session";

/**
 * Product management actions. Every one: (1) checks the caller's permission on the server,
 * (2) validates the input strictly, (3) calls a database function or a table update that checks the
 * permission again under Row Level Security. Nothing here trusts the browser.
 */
const DEMO: CatalogResult<never> = {
  ok: false,
  message: "Product changes need the real database. This is the demo, which has a fixed sample catalogue.",
};

const fail = (code: string, field?: string): CatalogResult<never> => ({ ok: false, message: catalogMessage(code), ...(field ? { field } : {}) });

async function gate(permission: string): Promise<{ s: AppSession } | { error: CatalogResult<never> }> {
  const s = await requireActionSession(permission);
  if (!s) return { error: fail("FORBIDDEN") };
  if (s.mode === "demo" || !s.client) return { error: DEMO };
  return { s };
}

const text = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional();
const paise = z.number().int().min(0).max(100_000_000_000);

const clothingSchema = z
  .object({
    idempotencyKey: z.uuid(),
    name: text(120),
    styleCode: opt(40),
    category: text(60),
    variants: z
      .array(
        z
          .object({
            size: opt(30), colour: opt(30), sku: opt(60), barcode: opt(48),
            pricePaise: paise, openingStock: z.number().int().min(0).max(100000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export interface CreatedClothing { productId: string; variants: { variantId: string; sku: string; barcode: string; size: string; colour: string }[] }

export async function createClothingAction(input: unknown): Promise<CatalogResult<CreatedClothing>> {
  const g = await gate("product.create");
  if ("error" in g) return g.error;
  const p = clothingSchema.safeParse(input);
  if (!p.success) return fail("VALIDATION_ERROR");
  const v = p.data;
  const style = v.styleCode?.trim() || v.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const { data, error } = await g.s.client!.rpc("catalog_create_clothing", {
    p_branch: g.s.branchId,
    p_name: v.name,
    p_style_code: style,
    p_category: v.category,
    p_hsn: null,
    p_variants: v.variants.map((x) => ({
      ...(x.size ? { size: x.size } : {}), ...(x.colour ? { colour: x.colour } : {}),
      ...(x.sku ? { sku: x.sku } : {}), ...(x.barcode ? { barcode: x.barcode } : {}),
      pricePaise: x.pricePaise, openingStock: x.openingStock ?? 0,
    })),
    p_idempotency_key: v.idempotencyKey,
  });
  if (error) return fail(dbCode(error));
  return { ok: true, data: data as CreatedClothing, message: `Saved ${v.name}.` };
}

const jewellerySchema = z
  .object({
    idempotencyKey: z.uuid(),
    kind: z.enum(["IMITATION", "PRECIOUS"]),
    name: text(120),
    category: text(60),
    tagCode: opt(20),
    barcode: opt(48),
    pricePaise: paise,
    metal: opt(20), purity: opt(12),
    grossWeightG: z.number().positive().max(100000).optional(),
    netWeightG: z.number().positive().max(100000).optional(),
  })
  .strict();

export interface CreatedJewellery { itemId: string; tagCode: string; barcode: string }

export async function createJewelleryAction(input: unknown): Promise<CatalogResult<CreatedJewellery>> {
  const g = await gate("product.create");
  if ("error" in g) return g.error;
  const p = jewellerySchema.safeParse(input);
  if (!p.success) return fail("VALIDATION_ERROR");
  const v = p.data;
  if (v.kind === "PRECIOUS" && (!v.metal || !v.purity || !v.grossWeightG || !v.netWeightG || v.netWeightG > v.grossWeightG)) {
    return fail("VALIDATION_ERROR", "weights");
  }
  const { data, error } = await g.s.client!.rpc("catalog_create_jewellery", {
    p_branch: g.s.branchId, p_kind: v.kind, p_name: v.name, p_category: v.category,
    p_tag_code: v.tagCode || null, p_price_paise: v.pricePaise,
    p_metal: v.metal ?? null, p_purity: v.purity ?? null,
    p_gross_g: v.grossWeightG ?? null, p_net_g: v.netWeightG ?? null,
    p_hsn: null, p_barcode: v.barcode || null, p_idempotency_key: v.idempotencyKey,
  });
  if (error) return fail(dbCode(error));
  return { ok: true, data: data as CreatedJewellery, message: `Saved ${v.name}.` };
}

const updateSchema = z
  .object({
    kind: z.enum(["VARIANT", "JEWELLERY"]),
    id: z.uuid(),
    pricePaise: paise.optional(),
    isActive: z.boolean().optional(),
    /** printed MRP in paise; null clears it. Clothing only. */
    mrpPaise: paise.nullable().optional(),
    /** low-stock alert level in units; null clears it. Clothing only. */
    reorderLevel: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .strict();

/**
 * Change price, MRP, availability and/or the low-stock level. Price and MRP need product.price_edit; availability and the reorder
 * level need product.edit. Each group present in the request is checked separately on the server, and the database checks again
 * under Row Level Security. Stock quantity is NOT changed here: only the inventory_adjust function can do that.
 */
export async function updateItemAction(input: unknown): Promise<CatalogResult> {
  const p = updateSchema.safeParse(input);
  if (!p.success) return fail("VALIDATION_ERROR");
  const v = p.data;
  const priceGroup = v.pricePaise !== undefined || v.mrpPaise !== undefined;
  const editGroup = v.isActive !== undefined || v.reorderLevel !== undefined;
  if (!priceGroup && !editGroup) return fail("VALIDATION_ERROR");
  if (v.kind === "JEWELLERY" && (v.mrpPaise !== undefined || v.reorderLevel !== undefined)) return fail("VALIDATION_ERROR");
  let g = await gate(priceGroup ? "product.price_edit" : "product.edit");
  if ("error" in g) return g.error;
  if (priceGroup && editGroup) {
    const second = await gate("product.edit");
    if ("error" in second) return second.error;
    g = second;
  }
  const db = g.s.client!;
  if (v.kind === "JEWELLERY") {
    const { error } = await db.rpc("catalog_update_jewellery", { p_item: v.id, p_price_paise: v.pricePaise ?? null, p_is_active: v.isActive ?? null });
    return error ? fail(dbCode(error)) : { ok: true, data: undefined, message: "Saved." };
  }
  if (priceGroup) {
    // The database refuses an MRP below the selling price; check here first so the message is clear and nothing is half-applied.
    const cur = await db.from("product_variants").select("selling_price, mrp").eq("id", v.id).maybeSingle();
    if (cur.error) return fail(dbCode(cur.error));
    if (!cur.data) return fail("NOT_FOUND");
    const price = v.pricePaise !== undefined ? v.pricePaise : Math.round(Number(cur.data.selling_price) * 100);
    const mrp = v.mrpPaise !== undefined ? v.mrpPaise : cur.data.mrp === null ? null : Math.round(Number(cur.data.mrp) * 100);
    if (mrp !== null && mrp < price) return fail("MRP_BELOW_PRICE", "mrp");
  }
  const patch: Record<string, unknown> = {};
  if (v.pricePaise !== undefined) patch.selling_price = v.pricePaise / 100;
  if (v.mrpPaise !== undefined) patch.mrp = v.mrpPaise === null ? null : v.mrpPaise / 100;
  if (v.reorderLevel !== undefined) patch.reorder_level = v.reorderLevel;
  if (v.isActive !== undefined) patch.is_active = v.isActive;
  if (Object.keys(patch).length === 0) return fail("VALIDATION_ERROR");
  const { data, error } = await db.from("product_variants").update(patch).eq("id", v.id).select("id");
  if (error) return fail(dbCode(error));
  if (!data || data.length === 0) return fail("FORBIDDEN"); // row-level security hid or refused the row
  return { ok: true, data: undefined, message: "Saved." };
}

const adjustSchema = z
  .object({
    idempotencyKey: z.uuid(), variantId: z.uuid(),
    delta: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, "zero"),
    reason: z.enum(["COUNT_CORRECTION", "FOUND", "DAMAGE", "LOSS", "WRITE_OFF", "OTHER"]),
    note: opt(200),
  })
  .strict();

export async function adjustStockAction(input: unknown): Promise<CatalogResult<{ balanceAfter: number }>> {
  const g = await gate("inventory.adjust");
  if ("error" in g) return g.error;
  const p = adjustSchema.safeParse(input);
  if (!p.success) return fail("VALIDATION_ERROR");
  const v = p.data;
  const { data, error } = await g.s.client!.rpc("inventory_adjust", {
    p_branch: g.s.branchId, p_variant: v.variantId, p_delta: v.delta, p_reason_code: v.reason, p_note: v.note ?? null, p_idempotency_key: v.idempotencyKey,
  });
  if (error) return fail(dbCode(error));
  return { ok: true, data: { balanceAfter: (data as { balanceAfter: number }).balanceAfter }, message: "Stock updated." };
}
