import { describe, expect, it, vi } from "vitest";
import {
  mapRpcError,
  SupabaseBillingBackend,
  type RpcClient,
  type RpcError,
} from "./supabase-backend";
import type { Quote } from "@/domain/billing";

const TARGET = { branchId: "branch-1", counterId: "counter-1" };
const quoteOf = (over: Partial<Quote> = {}): Quote => ({
  lines: [],
  itemCount: 0,
  discountTotalPaise: 0,
  grandTotalPaise: 0,
  taxConfigured: true,
  issues: [],
  ...over,
});

function backend(
  handler: (
    fn: string,
    args: Record<string, unknown>,
  ) => { data?: unknown; error?: RpcError | null } | Promise<never>,
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client: RpcClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const r = await handler(fn, args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { b: new SupabaseBillingBackend(client, TARGET), calls };
}

describe("mapRpcError", () => {
  it("passes through the database's stable business codes", () => {
    for (const code of [
      "ITEM_ALREADY_SOLD",
      "FORBIDDEN",
      "PRICE_STALE",
      "IDEMPOTENCY_KEY_REUSED",
      "TAX_NOT_CONFIGURED",
      "DISCOUNT_NOT_ALLOWED",
    ]) {
      expect(mapRpcError({ message: code }).code).toBe(code);
    }
  });

  it("carries the item and the fresh quote that the database attached", () => {
    const quote = quoteOf({ grandTotalPaise: 500 });
    const r = mapRpcError({
      message: "PRICE_STALE",
      details: JSON.stringify({ itemId: "i1", quote }),
    });
    expect(r).toEqual({ code: "PRICE_STALE", itemId: "i1", quote });
  });

  it("ignores malformed detail text", () => {
    expect(mapRpcError({ message: "FORBIDDEN", details: "{not json" })).toEqual({
      code: "FORBIDDEN",
    });
  });

  it("treats lock timeouts, deadlocks and serialisation failures as retryable", () => {
    for (const code of ["55P03", "40P01", "40001"])
      expect(mapRpcError({ message: "x", code }).code).toBe("CONCURRENT_UPDATE");
  });

  it("maps privilege failures to FORBIDDEN and network failures to NETWORK", () => {
    expect(
      mapRpcError({ message: "permission denied for table invoices", code: "42501" }).code,
    ).toBe("FORBIDDEN");
    expect(mapRpcError({ message: "new row violates row-level security policy" }).code).toBe(
      "FORBIDDEN",
    );
    expect(mapRpcError({ message: "TypeError: fetch failed" }).code).toBe("NETWORK");
  });

  it("never exposes an unexpected database message to the browser", () => {
    const r = mapRpcError({
      message: 'relation "public.secret_table" does not exist',
      code: "42P01",
      details: "internal detail",
    });
    expect(r).toEqual({ code: "INTERNAL" });
    expect(JSON.stringify(r)).not.toContain("secret_table");
  });
});

describe("SupabaseBillingBackend", () => {
  it("always sends the branch from the authenticated context, never from the request", async () => {
    const { b, calls } = backend(() => ({ data: quoteOf() }));
    await b.quote([{ itemId: "i1", quantity: 1 }]);
    await b.search("shirt");
    expect(calls.map((c) => c.args.p_branch)).toEqual(["branch-1", "branch-1"]);
  });

  it("scan resolves the code exactly, then prices the cart with the item added", async () => {
    const { b, calls } = backend((fn) =>
      fn === "resolve_barcode"
        ? { data: { itemId: "i1", itemType: "VARIANT" } }
        : { data: quoteOf({ itemCount: 1 }) },
    );
    const r = await b.scan("NR00000001", []);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["resolve_barcode", "pos_quote_cart"]);
    expect(calls[0]?.args).toEqual({ p_branch: "branch-1", p_code: "NR00000001" });
    expect(calls[1]?.args.p_lines).toEqual([{ itemId: "i1", quantity: 1 }]);
  });

  it("increments the quantity of a clothing line and keeps any discount on it", async () => {
    const { b, calls } = backend((fn) =>
      fn === "resolve_barcode" ? { data: { itemId: "i1" } } : { data: quoteOf() },
    );
    await b.scan("NR00000001", [
      { itemId: "i1", quantity: 2, discountPaise: 500, discountReason: "offer" },
    ]);
    expect(calls[1]?.args.p_lines).toEqual([
      { itemId: "i1", quantity: 3, discountPaise: 500, discountReason: "offer" },
    ]);
  });

  it("an unknown barcode stops before any pricing call", async () => {
    const { b, calls } = backend(() => ({ error: { message: "BARCODE_NOT_FOUND" } }));
    expect(await b.scan("NOPE0000", [])).toEqual({ ok: false, code: "BARCODE_NOT_FOUND" });
    expect(calls).toHaveLength(1);
  });

  it("reports a problem with the added item and leaves the cart alone", async () => {
    const { b } = backend((fn) =>
      fn === "resolve_barcode"
        ? { data: { itemId: "i1" } }
        : { data: quoteOf({ issues: [{ itemId: "i1", code: "ITEM_ALREADY_SOLD" }] }) },
    );
    expect(await b.scan("IJ0000124", [])).toEqual({
      ok: false,
      code: "ITEM_ALREADY_SOLD",
      itemId: "i1",
    });
  });

  it("does not let another line's problem block adding a good item", async () => {
    const { b } = backend((fn) =>
      fn === "resolve_barcode"
        ? { data: { itemId: "i2" } }
        : { data: quoteOf({ issues: [{ itemId: "old", code: "INSUFFICIENT_STOCK" }] }) },
    );
    expect((await b.scan("NR00000002", [{ itemId: "old", quantity: 1 }])).ok).toBe(true);
  });

  it("turns a second scan of a one-of-a-kind piece into ALREADY_IN_CART", async () => {
    const { b } = backend((fn) =>
      fn === "resolve_barcode"
        ? { data: { itemId: "j1" } }
        : { data: quoteOf({ issues: [{ itemId: "j1", code: "VALIDATION_ERROR" }] }) },
    );
    expect(await b.scan("IJ0000123", [{ itemId: "j1", quantity: 1 }])).toEqual({
      ok: false,
      code: "ALREADY_IN_CART",
      itemId: "j1",
    });
  });

  it("sends checkout with the idempotency key and the exact arguments, and relays the confirmed invoice", async () => {
    const invoice = {
      invoiceId: "inv",
      invoiceNumber: "INV-000001",
      issuedAt: "x",
      lines: [],
      grandTotalPaise: 100,
      paidPaise: 100,
      changePaise: 0,
      payments: [],
      taxConfigured: true,
      replayed: false,
    };
    const { b, calls } = backend(() => ({ data: invoice }));
    const input = {
      idempotencyKey: "3f8f6b1e-5d2a-4c1b-9a53-0b6f3e2d9c11",
      lines: [{ itemId: "i1", quantity: 1 }],
      payments: [{ method: "CASH" as const, amountPaise: 100 }],
      expectedTotalPaise: 100,
    };
    expect(await b.checkout(input)).toEqual({ ok: true, data: invoice });
    expect(calls[0]).toEqual({
      fn: "pos_checkout",
      args: {
        p_branch: "branch-1",
        p_counter: "counter-1",
        p_idempotency_key: input.idempotencyKey,
        p_lines: input.lines,
        p_payments: input.payments,
        p_expected_total_paise: 100,
        p_customer: null,
      },
    });
  });

  it("surfaces a refusal as a failure and never as a success", async () => {
    const { b } = backend(() => ({ error: { message: "PAYMENT_NOT_CONFIRMED" } }));
    const r = await b.checkout({
      idempotencyKey: "k",
      lines: [],
      payments: [],
      expectedTotalPaise: 0,
    });
    expect(r).toEqual({ ok: false, code: "PAYMENT_NOT_CONFIRMED" });
  });

  it("reports a thrown network error as NETWORK, so the caller retries with the same key", async () => {
    const { b } = backend(() => Promise.reject(new Error("socket hang up")));
    expect(
      await b.checkout({ idempotencyKey: "k", lines: [], payments: [], expectedTotalPaise: 0 }),
    ).toEqual({ ok: false, code: "NETWORK" });
  });

  it("start of day sends the counter and the opening float in paise", async () => {
    const { b, calls } = backend(() => ({
      data: { open: true, openingFloatPaise: 5000, openedAt: "x" },
    }));
    await b.startDay(5000);
    expect(calls[0]).toEqual({
      fn: "pos_start_day",
      args: { p_branch: "branch-1", p_counter: "counter-1", p_opening_float_paise: 5000 },
    });
  });

  it("holds no business rules of its own: it makes no call other than the documented functions", async () => {
    const seen = vi.fn();
    const { b } = backend((fn) => {
      seen(fn);
      return { data: fn === "resolve_barcode" ? { itemId: "i" } : quoteOf() };
    });
    await b.getSession();
    await b.startDay(0);
    await b.scan("ABCD1234", []);
    await b.search("ab");
    await b.addItem("i", []);
    await b.quote([]);
    await b.checkout({ idempotencyKey: "k", lines: [], payments: [], expectedTotalPaise: 0 });
    expect(new Set(seen.mock.calls.map((c) => c[0]))).toEqual(
      new Set([
        "pos_get_session",
        "pos_start_day",
        "resolve_barcode",
        "pos_quote_cart",
        "catalog_search",
        "pos_checkout",
      ]),
    );
  });
});
