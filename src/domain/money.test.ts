import { describe, expect, it } from "vitest";
import { isPaise, isWithinPercent, percentOfPaise, sumPaise } from "./money";

describe("integer paise arithmetic", () => {
  it("sums exactly where floating point would drift", () => {
    // 0.1 + 0.2 !== 0.3 in floating point rupees; in paise it is exact.
    expect(10 + 20).toBe(30);
    expect(sumPaise([10, 20])).toBe(30);
    expect(sumPaise(Array.from({ length: 1000 }, () => 10))).toBe(10000);
  });

  it("rejects amounts that are not whole non-negative paise", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(isPaise(bad)).toBe(false);
      expect(() => sumPaise([100, bad])).toThrow(RangeError);
    }
    expect(isPaise("100")).toBe(false);
    expect(isPaise(null)).toBe(false);
  });

  it("accepts zero and ordinary amounts", () => {
    expect(isPaise(0)).toBe(true);
    expect(isPaise(129900)).toBe(true);
    expect(sumPaise([])).toBe(0);
  });

  it("computes percentages in basis points, rounded half-up, with integers", () => {
    expect(percentOfPaise(10000, 500)).toBe(500); // 5% of ₹100
    expect(percentOfPaise(999, 1000)).toBe(100); // 10% of 9.99 = 0.999 -> 1.00
    expect(percentOfPaise(5, 1000)).toBe(1); // 0.5 paise rounds up
    expect(percentOfPaise(4, 1000)).toBe(0); // 0.4 paise rounds down
    expect(percentOfPaise(129900, 10000)).toBe(129900);
    expect(percentOfPaise(129900, 0)).toBe(0);
  });

  it("rejects invalid percentage inputs", () => {
    expect(() => percentOfPaise(100, -1)).toThrow(RangeError);
    expect(() => percentOfPaise(100, 10001)).toThrow(RangeError);
    expect(() => percentOfPaise(100, 1.5)).toThrow(RangeError);
    expect(() => percentOfPaise(-100, 500)).toThrow(RangeError);
  });

  it("checks 'within percent' exactly, with no rounding loophole", () => {
    // 10% of 99.99 is 9.999; a discount of 10.00 is over the limit even though it rounds to 10%.
    expect(isWithinPercent(999, 9999, 1000)).toBe(true);
    expect(isWithinPercent(1000, 9999, 1000)).toBe(false);
    expect(isWithinPercent(0, 9999, 0)).toBe(true);
    expect(isWithinPercent(1, 9999, 0)).toBe(false);
    expect(isWithinPercent(9999, 9999, 10000)).toBe(true);
  });
});
