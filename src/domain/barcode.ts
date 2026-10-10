/**
 * Barcodes are resolved by EXACT match only. This module is the single place that defines how a
 * scanned or typed value is normalised before an exact lookup. There is deliberately no
 * "starts with" / "contains" / fuzzy helper here (UX plan §3.2, rule 3).
 */

/** Trim, drop control characters scanners may append, and uppercase. */
export function normalizeCode(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .toUpperCase();
}

/** Codes are 4–48 uppercase letters/digits (matches DATABASE_DESIGN §7). */
export function looksLikeBarcode(normalized: string): boolean {
  return /^[A-Z0-9]{4,48}$/.test(normalized);
}

/**
 * Keyboard-wedge scanners type very fast. A burst is a sequence of characters whose
 * inter-key gaps are all below `maxGapMs`. Used only to decide whether to refocus/capture input,
 * never to decide what a value means; the server decides that by exact lookup.
 */
export function isScannerBurst(timestamps: number[], minChars = 4, maxGapMs = 35): boolean {
  if (timestamps.length < minChars) return false;
  for (let i = 1; i < timestamps.length; i++) {
    if ((timestamps[i] as number) - (timestamps[i - 1] as number) > maxGapMs) return false;
  }
  return true;
}
