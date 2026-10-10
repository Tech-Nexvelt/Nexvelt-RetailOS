/**
 * Tests of the trusted server-action layer: authorization, input validation and role policy.
 * `next/headers` and `server-only` are replaced by test doubles, so this proves the action code,
 * not Next.js cookie handling or real authentication (Phase 2).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cookieRole: undefined as string | undefined,
  denyAll: false,
  setCalls: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "nv_demo_role" && h.cookieRole ? { value: h.cookieRole } : undefined,
    set: (...args: unknown[]) => {
      h.setCalls.push(args);
    },
  }),
}));
vi.mock("@/domain/navigation", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domain/navigation")>();
  return {
    ...original,
    can: (role: never, perm: string) => !h.denyAll && original.can(role, perm),
  };
});

import * as actions from "./actions";
import type { CheckoutInput, PaymentInput } from "@/domain/billing";

const KEY = "3f8f6b1e-5d2a-4c1b-9a53-0b6f3e2d9c11";
const cash = (n: number): PaymentInput[] => [{ method: "CASH", amountPaise: n }];

function checkoutInput(over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    idempotencyKey: KEY,
    lines: [{ itemId: "v1", quantity: 1 }],
    expectedTotalPaise: 129900,
    payments: cash(129900),
    ...over,
  };
}

beforeEach(async () => {
  (globalThis as { __nexveltDemoEngine?: unknown }).__nexveltDemoEngine = undefined;
  h.cookieRole = "cashier";
  h.denyAll = false;
  h.setCalls.length = 0;
  vi.unstubAllEnvs();
  vi.stubEnv("BILLING_BACKEND", "demo");
  await actions.startDay(0);
});

describe("authorization is enforced on the server for every action", () => {
  it("refuses every billing action when the caller lacks pos.sell", async () => {
    h.denyAll = true;
    const results = [
      await actions.getSession(),
      await actions.startDay(0),
      await actions.scanBarcode("NR00000001", []),
      await actions.searchItems("shirt"),
      await actions.addItem("v1", []),
      await actions.quoteCart([]),
      await actions.completeCheckout(checkoutInput()),
    ];
    for (const r of results) expect(r).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("does not change anything when a forbidden checkout is attempted", async () => {
    h.denyAll = true;
    await actions.completeCheckout(checkoutInput());
    h.denyAll = false;
    const s = await actions.scanBarcode("NR00000001", []);
    expect(s.ok && s.data.lines[0]?.maxQuantity).toBe(5); // stock untouched
  });

  it("treats an unknown or tampered role cookie as the least-privileged role", async () => {
    for (const value of ["admin", "OWNER", "owner ", "", "platform_admin"]) {
      h.cookieRole = value;
      const r = await actions.completeCheckout(
        checkoutInput({
          idempotencyKey: crypto.randomUUID(),
          lines: [{ itemId: "v1", quantity: 1, discountPaise: 100, discountReason: "Try" }],
          expectedTotalPaise: 129800,
          payments: cash(129800),
        }),
      );
      expect(r, `cookie "${value}"`).toMatchObject({ ok: false, code: "DISCOUNT_NOT_ALLOWED" });
    }
  });
});

describe("discount authority comes from the server-side role", () => {
  const discounted = (key: string) =>
    checkoutInput({
      idempotencyKey: key,
      lines: [{ itemId: "v1", quantity: 1, discountPaise: 10000, discountReason: "Festival" }],
      expectedTotalPaise: 119900,
      payments: cash(119900),
    });

  it("refuses a cashier's discount", async () => {
    h.cookieRole = "cashier";
    expect(await actions.completeCheckout(discounted(crypto.randomUUID()))).toMatchObject({
      ok: false,
      code: "DISCOUNT_NOT_ALLOWED",
    });
  });

  it("refuses a manager's discount until the client sets a limit (OQ-21)", async () => {
    h.cookieRole = "manager";
    expect(await actions.completeCheckout(discounted(crypto.randomUUID()))).toMatchObject({
      ok: false,
      code: "DISCOUNT_NOT_ALLOWED",
    });
  });

  it("allows the owner's discount", async () => {
    h.cookieRole = "owner";
    const r = await actions.completeCheckout(discounted(crypto.randomUUID()));
    expect(r.ok && r.data.grandTotalPaise).toBe(119900);
  });

  it("applies the same rule when a discount is submitted while scanning or quoting", async () => {
    h.cookieRole = "cashier";
    const cart = [{ itemId: "v1", quantity: 1, discountPaise: 500, discountReason: "x" }];
    const q = await actions.quoteCart(cart);
    expect(q.ok && q.data.issues[0]?.code).toBe("DISCOUNT_NOT_ALLOWED");
    const s = await actions.scanBarcode("NR00000001", cart);
    expect(s.ok && s.data.issues[0]?.code).toBe("DISCOUNT_NOT_ALLOWED");
  });
});

describe("the browser cannot choose prices or totals", () => {
  it("rejects a client-supplied price field instead of ignoring it", async () => {
    const lines = [{ itemId: "v1", quantity: 1, unitPricePaise: 1 }];
    const r = await actions.completeCheckout(
      checkoutInput({ lines: lines as unknown as CheckoutInput["lines"], expectedTotalPaise: 1 }),
    );
    expect(r).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    expect(await actions.quoteCart(lines as never)).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects extra fields on payments, customer and the request itself", async () => {
    const withExtra = (patch: object) =>
      actions.completeCheckout({ ...checkoutInput(), ...patch } as unknown as CheckoutInput);
    expect(await withExtra({ grandTotalPaise: 1 })).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await withExtra({ customer: { name: "A", isVip: true } })).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(
      await withExtra({ payments: [{ method: "CASH", amountPaise: 129900, status: "PAID" }] }),
    ).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("recomputes the total on the server and rejects a lower client total", async () => {
    const r = await actions.completeCheckout(
      checkoutInput({ expectedTotalPaise: 100, payments: cash(100) }),
    );
    expect(r).toMatchObject({ ok: false, code: "PRICE_STALE" });
  });
});

describe("input validation", () => {
  it("requires a UUID idempotency key", async () => {
    for (const idempotencyKey of ["", "abc", "1", "not-a-uuid"]) {
      expect(await actions.completeCheckout(checkoutInput({ idempotencyKey }))).toEqual({
        ok: false,
        code: "VALIDATION_ERROR",
      });
    }
  });

  it("rejects malformed money and quantities before they reach the engine", async () => {
    const bad: Partial<CheckoutInput>[] = [
      { expectedTotalPaise: -1 },
      { expectedTotalPaise: 1.5 },
      { lines: [{ itemId: "v1", quantity: 0 }] },
      { lines: [{ itemId: "v1", quantity: 1.5 }] },
      { lines: [{ itemId: "", quantity: 1 }] },
      { payments: [{ method: "BITCOIN" as never, amountPaise: 129900 }] },
      { payments: Array.from({ length: 7 }, () => ({ method: "CASH", amountPaise: 1 })) as never },
    ];
    for (const patch of bad) {
      expect(await actions.completeCheckout(checkoutInput(patch)), JSON.stringify(patch)).toEqual({
        ok: false,
        code: "VALIDATION_ERROR",
      });
    }
  });

  it("rejects oversized barcode and search input", async () => {
    expect(await actions.scanBarcode("A".repeat(129), [])).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(await actions.searchItems("a".repeat(81))).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects an invalid opening float", async () => {
    for (const v of [-1, 1.5, Number.NaN]) {
      expect(await actions.startDay(v)).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    }
  });
});

describe("end-to-end through the action layer", () => {
  it("scans an exact barcode, refuses a partial one, and completes a bill once", async () => {
    expect(await actions.scanBarcode("NR0000000", [])).toMatchObject({
      ok: false,
      code: "BARCODE_NOT_FOUND",
    });
    const scan = await actions.scanBarcode("nr00000001", []);
    expect(scan.ok && scan.data.grandTotalPaise).toBe(129900);

    const input = checkoutInput({ idempotencyKey: crypto.randomUUID() });
    const first = await actions.completeCheckout(input);
    const again = await actions.completeCheckout(input);
    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) {
      expect(again.data.invoiceNumber).toBe(first.data.invoiceNumber);
      expect(again.data.replayed).toBe(true);
    }
  });

  it("cannot bill before the day has started", async () => {
    (globalThis as { __nexveltDemoEngine?: unknown }).__nexveltDemoEngine = undefined;
    expect(await actions.completeCheckout(checkoutInput())).toMatchObject({
      ok: false,
      code: "SESSION_NOT_OPEN",
    });
  });
});

describe("the demo backend fails closed", () => {
  const unset = async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("BILLING_BACKEND", "");
    (globalThis as { __nexveltDemoEngine?: unknown }).__nexveltDemoEngine = undefined;
  };

  it("refuses every billing action when BILLING_BACKEND is not 'demo' (no silent fake data)", async () => {
    await unset();
    const results = [
      await actions.getSession(),
      await actions.startDay(0),
      await actions.scanBarcode("NR00000001", []),
      await actions.searchItems("shirt"),
      await actions.addItem("v1", []),
      await actions.quoteCart([]),
      await actions.completeCheckout(checkoutInput()),
    ];
    for (const r of results) expect(r).toEqual({ ok: false, code: "INTERNAL" });
  });

  it("does not even create the in-memory engine when the backend is not configured", async () => {
    await unset();
    await actions.completeCheckout(checkoutInput());
    expect((globalThis as { __nexveltDemoEngine?: unknown }).__nexveltDemoEngine).toBeUndefined();
  });

  it("treats look-alike values as not configured", async () => {
    for (const v of ["DEMO", "true", "1", "demo ", "production"]) {
      vi.unstubAllEnvs();
      vi.stubEnv("BILLING_BACKEND", v);
      expect(await actions.quoteCart([]), v).toEqual({ ok: false, code: "INTERNAL" });
    }
  });
});

describe("DEMO MODE IS REFUSED IN PRODUCTION", () => {
  const prod = () => {
    vi.unstubAllEnvs();
    vi.stubEnv("BILLING_BACKEND", "demo");
    vi.stubEnv("NODE_ENV", "production");
    (globalThis as { __nexveltDemoEngine?: unknown }).__nexveltDemoEngine = undefined;
  };

  it("every billing action fails closed, even for a cashier cookie with full permission", async () => {
    prod();
    h.cookieRole = "owner";
    const results = [
      await actions.getSession(),
      await actions.startDay(0),
      await actions.scanBarcode("NR00000001", []),
      await actions.searchItems("shirt"),
      await actions.addItem("v1", []),
      await actions.quoteCart([]),
      await actions.completeCheckout(checkoutInput()),
    ];
    for (const r of results) expect(r).toEqual({ ok: false, code: "INTERNAL" });
  });

  it("never creates the in-memory engine and never lets the role cookie be set", async () => {
    prod();
    await actions.completeCheckout(checkoutInput());
    expect((globalThis as { __nexveltDemoEngine?: unknown }).__nexveltDemoEngine).toBeUndefined();
    await actions.switchDemoRole("owner");
    expect(h.setCalls).toHaveLength(0);
  });

  it("demo billing still works in development (no regression)", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("BILLING_BACKEND", "demo");
    vi.stubEnv("NODE_ENV", "development");
    (globalThis as { __nexveltDemoEngine?: unknown }).__nexveltDemoEngine = undefined;
    expect((await actions.getSession()).ok).toBe(true);
  });
});

describe("demo role switch", () => {
  it("sets the cookie in development for a valid role only", async () => {
    await actions.switchDemoRole("owner");
    expect(h.setCalls).toHaveLength(1);
    await actions.switchDemoRole("superuser");
    expect(h.setCalls).toHaveLength(1);
  });

  it("does nothing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await actions.switchDemoRole("owner");
    expect(h.setCalls).toHaveLength(0);
  });
});
