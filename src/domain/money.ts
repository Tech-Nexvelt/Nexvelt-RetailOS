/**
 * Money is always an integer number of paise. Floating point is never used for amounts.
 * The server is the only authority for totals; the client only formats what it receives.
 */
export type Paise = number;

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(paise: Paise): string {
  return inr.format(paise / 100);
}

/**
 * Parse a user-typed rupee amount ("1,299", "1299.5", "₹ 10.05") into paise.
 * Returns null for anything that is not a plain non-negative amount with at most 2 decimals.
 * Parsing is done on the digits, never through floating point.
 */
export function parseRupees(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const rupees = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return rupees * 100 + Number(fraction);
}

export function isPaise(value: unknown): value is Paise {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Sum of integer paise. Throws if the result would leave the safe-integer range. */
export function sumPaise(values: Paise[]): Paise {
  let total = 0;
  for (const v of values) {
    if (!isPaise(v)) throw new RangeError("Amount must be a non-negative whole number of paise");
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError("Amount is too large");
  }
  return total;
}

/**
 * `bps` basis points (1% = 100 bps) of an amount, rounded half-up, using integers only.
 * 10000 bps = 100%.
 */
export function percentOfPaise(amount: Paise, bps: number): Paise {
  if (!isPaise(amount) || !Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new RangeError("Invalid amount or percentage");
  }
  return Math.floor((amount * bps + 5000) / 10000);
}

/** True if `part` is at most `bps` basis points of `whole`. Exact: no rounding involved. */
export function isWithinPercent(part: Paise, whole: Paise, bps: number): boolean {
  return part * 10000 <= whole * bps;
}
