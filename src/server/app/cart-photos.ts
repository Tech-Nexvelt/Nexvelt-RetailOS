/**
 * Photo URLs for the items in a bill. The database function that prices a cart knows nothing about photos, so after it answers the
 * server looks up each line's photo and attaches a short-lived signed URL. Cosmetic by design: ANY failure returns the quote unchanged
 * (placeholders) and never blocks billing. Reads use the signed-in user's own client, so row-level security and storage policies apply.
 */
import type { Quote, SearchResult } from "@/domain/billing";
import { signedUrls, type ImageClient } from "./images";

type Row = Record<string, unknown>;
type Q = Promise<{ data: Row[] | null; error: { message?: string } | null }>;
/** the slice of the Supabase client used here: batched reads plus signed URLs */
export interface PhotoClient {
  from(table: string): { select(cols: string): { in(col: string, vals: string[]): Q } };
  storage: ImageClient["storage"];
}

interface ItemRef {
  id: string;
  kind: "CLOTHING" | "IMITATION_JEWELLERY" | "PRECIOUS_JEWELLERY";
}

const rows = async (q: Q): Promise<Row[]> => {
  const r = await q;
  return r.error || !r.data ? [] : r.data;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** itemId -> signed URL, only for items that HAVE a photo. */
export async function photoUrlsFor(client: PhotoClient, tenantId: string, items: ItemRef[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const clothing = [...new Set(items.filter((i) => i.kind === "CLOTHING" && UUID.test(i.id)).map((i) => i.id))];
  const pieces = [...new Set(items.filter((i) => i.kind !== "CLOTHING" && UUID.test(i.id)).map((i) => i.id))];
  if (clothing.length + pieces.length === 0) return out;

  // item -> the product or design that holds the photo
  const [variants, jewels] = await Promise.all([
    clothing.length ? rows(client.from("product_variants").select("id, product_id").in("id", clothing)) : [],
    pieces.length ? rows(client.from("jewellery_items").select("id, design_id").in("id", pieces)) : [],
  ]);
  const productOf = new Map(variants.map((v) => [String(v.id), String(v.product_id)]));
  const designOf = new Map(jewels.map((j) => [String(j.id), String(j.design_id)]));
  const [products, designs] = await Promise.all([
    productOf.size ? rows(client.from("products").select("id, image_path").in("id", [...new Set(productOf.values())])) : [],
    designOf.size ? rows(client.from("jewellery_designs").select("id, image_path").in("id", [...new Set(designOf.values())])) : [],
  ]);
  const pathOfProduct = new Map(products.filter((p) => typeof p.image_path === "string").map((p) => [String(p.id), String(p.image_path)]));
  const pathOfDesign = new Map(designs.filter((d) => typeof d.image_path === "string").map((d) => [String(d.id), String(d.image_path)]));

  const pathOfItem = new Map<string, string>();
  for (const [item, product] of productOf) if (pathOfProduct.has(product)) pathOfItem.set(item, pathOfProduct.get(product)!);
  for (const [item, design] of designOf) if (pathOfDesign.has(design)) pathOfItem.set(item, pathOfDesign.get(design)!);
  if (pathOfItem.size === 0) return out;

  const urls = await signedUrls(client as unknown as ImageClient, tenantId, [...pathOfItem.values()]);
  for (const [item, path] of pathOfItem) {
    const u = urls.get(path);
    if (u) out.set(item, u);
  }
  return out;
}

/** Attach `imageUrl` to every line of a quote. Never throws; on any problem the quote is returned as it was. */
export async function quoteWithPhotos(client: PhotoClient, tenantId: string, quote: Quote): Promise<Quote> {
  try {
    const urls = await photoUrlsFor(client, tenantId, quote.lines.map((l) => ({ id: l.itemId, kind: l.kind })));
    if (urls.size === 0) return quote;
    return { ...quote, lines: quote.lines.map((l) => ({ ...l, imageUrl: urls.get(l.itemId) ?? null })) };
  } catch {
    return quote;
  }
}

export async function resultsWithPhotos(client: PhotoClient, tenantId: string, results: SearchResult[]): Promise<SearchResult[]> {
  try {
    const urls = await photoUrlsFor(client, tenantId, results.map((r) => ({ id: r.itemId, kind: r.kind })));
    if (urls.size === 0) return results;
    return results.map((r) => ({ ...r, imageUrl: urls.get(r.itemId) ?? null }));
  } catch {
    return results;
  }
}
