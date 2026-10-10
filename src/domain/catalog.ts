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
