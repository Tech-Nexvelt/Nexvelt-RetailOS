/** Shared types and plain-language messages for product management. */
export type ProductKind = "CLOTHING" | "IMITATION" | "PRECIOUS";

export interface CatalogRow {
  kind: "VARIANT" | "JEWELLERY";
  id: string;
  name: string;
  /** "M / Blue" for clothing, the tag code for jewellery. */
  detail: string;
  barcode: string;
  pricePaise: number;
  /** Units on hand for clothing; null for a one-of-a-kind jewellery piece. */
  stock: number | null;
  /** "In stock", "Sold", "On hold", "Switched off" … */
  status: string;
  active: boolean;
  /** Warn when stock is at or below this many units. Null = no alert set. Clothing only. */
  reorderLevel: number | null;
  /** Printed maximum retail price in paise, when known. Never below the selling price (the database enforces it). */
  mrpPaise: number | null;
}

/** Stock is low when a reorder level is set, there is still some stock, and it is at or below that level. */
export const isLowStock = (r: Pick<CatalogRow, "kind" | "stock" | "reorderLevel" | "active">): boolean =>
  r.kind === "VARIANT" && r.active && r.reorderLevel !== null && r.stock !== null && r.stock > 0 && r.stock <= r.reorderLevel;

export const isOutOfStock = (r: Pick<CatalogRow, "kind" | "stock" | "active">): boolean => r.kind === "VARIANT" && r.active && r.stock !== null && r.stock <= 0;

export type StatusFilter = "all" | "in_stock" | "low" | "out" | "off";
export type KindFilter = "all" | "clothing" | "jewellery";
export type SortKey = "name" | "price" | "stock";
export interface CatalogQuery { status: StatusFilter; kind: KindFilter; sort: SortKey; dir: "asc" | "desc"; page: number; pageSize: number }
export const DEFAULT_QUERY: CatalogQuery = { status: "all", kind: "all", sort: "name", dir: "asc", page: 1, pageSize: 25 };

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);
/** Parse untrusted URL parameters into a safe query. Anything unrecognised falls back to the default. */
export function parseCatalogQuery(p: Record<string, string | undefined>): CatalogQuery {
  const page = Number.parseInt(p.page ?? "1", 10);
  return {
    status: pick(p.status, ["all", "in_stock", "low", "out", "off"] as const, "all"),
    kind: pick(p.kind, ["all", "clothing", "jewellery"] as const, "all"),
    sort: pick(p.sort, ["name", "price", "stock"] as const, "name"),
    dir: pick(p.dir, ["asc", "desc"] as const, "asc"),
    page: Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    pageSize: DEFAULT_QUERY.pageSize,
  };
}

const statusOk = (r: CatalogRow, f: StatusFilter) =>
  f === "all" || (f === "off" ? !r.active : f === "low" ? isLowStock(r) : f === "out" ? isOutOfStock(r) || (r.active && r.kind === "JEWELLERY" && r.status === "Sold") : r.active && r.status === "In stock");

/** Filter, sort and paginate the (already permission-scoped) rows. Pure: never reads or writes anything. */
export function queryCatalog(rows: CatalogRow[], q: CatalogQuery): { rows: CatalogRow[]; total: number; page: number; pages: number } {
  const kept = rows.filter((r) => statusOk(r, q.status) && (q.kind === "all" || (q.kind === "clothing" ? r.kind === "VARIANT" : r.kind === "JEWELLERY")));
  const sign = q.dir === "desc" ? -1 : 1;
  const stockOf = (r: CatalogRow) => (r.stock === null ? (r.status === "In stock" ? 1 : 0) : r.stock);
  kept.sort((a, b) => {
    const primary = q.sort === "price" ? a.pricePaise - b.pricePaise : q.sort === "stock" ? stockOf(a) - stockOf(b) : a.name.localeCompare(b.name);
    return sign * primary || a.name.localeCompare(b.name) || a.detail.localeCompare(b.detail) || a.id.localeCompare(b.id);
  });
  const pages = Math.max(1, Math.ceil(kept.length / q.pageSize));
  const page = Math.min(q.page, pages);
  return { rows: kept.slice((page - 1) * q.pageSize, page * q.pageSize), total: kept.length, page, pages };
}

export type CatalogResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; message: string; field?: string };

export const CATALOG_ERRORS: Record<string, string> = {
  STYLE_CODE_TAKEN: "Another product already uses that style code. Use a different one.",
  SKU_TAKEN: "Another product already uses that SKU. Change the SKU or leave it blank to generate one.",
  VARIANT_DUPLICATE: "Two variants have the same size and colour. Each size and colour can appear once.",
  BARCODE_TAKEN: "That barcode is already used by another item. Every barcode must be unique.",
  TAG_CODE_TAKEN: "That tag code is already used by another piece. Use a different tag, or leave it blank.",
  DUPLICATE: "Something with the same details already exists.",
  ITEM_SOLD_LOCKED: "This piece has been sold, so its price can no longer be changed.",
  VALIDATION_ERROR: "Some details are missing or not valid. Check the highlighted fields.",
  FORBIDDEN: "Your role cannot do this. Ask the owner.",
  UNAUTHENTICATED: "You are signed out. Sign in again.",
  NOT_FOUND: "That item no longer exists. Refresh the page.",
  INSUFFICIENT_STOCK: "That would make the stock go below zero. Check the quantity.",
  IDEMPOTENCY_KEY_REUSED: "This form was already submitted with different details. Refresh the page and try again.",
  CONCURRENT_UPDATE: "Someone else changed this at the same time. Try again.",
  MRP_BELOW_PRICE: "The MRP cannot be lower than the selling price.",
  NETWORK: "No connection to the server. Nothing was saved. Try again.",
  INTERNAL: "Something went wrong on our side. Nothing was saved. Try again; if it repeats, call support.",
};

export function catalogMessage(code: string): string {
  return CATALOG_ERRORS[code] ?? CATALOG_ERRORS.INTERNAL!;
}

/** Stock-adjustment reasons the owner can choose (matches the database list). */
export const ADJUST_REASONS = [
  { value: "COUNT_CORRECTION", label: "Stock count correction" },
  { value: "FOUND", label: "Found / received extra" },
  { value: "DAMAGE", label: "Damaged" },
  { value: "LOSS", label: "Lost or stolen" },
  { value: "WRITE_OFF", label: "Write off" },
  { value: "OTHER", label: "Other" },
] as const;
