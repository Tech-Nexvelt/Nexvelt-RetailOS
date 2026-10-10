/** Turn a database error into one of our plain codes. The raw message never reaches the browser. */
export function dbCode(e: { message?: string; code?: string } | null | undefined): string {
  const m = e?.message ?? "";
  if (m in { STYLE_CODE_TAKEN: 1, SKU_TAKEN: 1, VARIANT_DUPLICATE: 1, BARCODE_TAKEN: 1, TAG_CODE_TAKEN: 1, DUPLICATE: 1, ITEM_SOLD_LOCKED: 1,
    VALIDATION_ERROR: 1, FORBIDDEN: 1, UNAUTHENTICATED: 1, NOT_FOUND: 1, INSUFFICIENT_STOCK: 1, IDEMPOTENCY_KEY_REUSED: 1, CONCURRENT_UPDATE: 1 }) return m;
  if (e?.code === "55P03" || e?.code === "40P01" || e?.code === "40001") return "CONCURRENT_UPDATE";
  if (e?.code === "42501" || /permission denied|row-level security/i.test(m)) return "FORBIDDEN";
  if (/fetch failed|network|ECONN|timeout/i.test(m)) return "NETWORK";
  return "INTERNAL";
}

