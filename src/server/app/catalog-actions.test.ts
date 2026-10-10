// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** A tiny fake of the Supabase query builder: records what was written and answers reads from `state`. */
const state = { current: { selling_price: "1299.00", mrp: null as string | null } as { selling_price: string; mrp: string | null } | null, updateResult: { data: [{ id: "x" }] as unknown[] | null, error: null as { message?: string; code?: string } | null }, rpcError: null as { message?: string; code?: string } | null };
const calls: { table?: string; patch?: Record<string, unknown>; rpc?: [string, Record<string, unknown>] }[] = [];
const client = {
  from(table: string) {
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.current, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        calls.push({ table, patch });
        return { eq: () => ({ select: async () => state.updateResult }) };
      },
    };
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ rpc: [name, args] });
    return { data: { balanceAfter: 7 }, error: state.rpcError };
  },
};

/** Which permissions the signed-in user holds. requireActionSession returns null when the permission is missing, like the real one. */
let held = new Set<string>();
let mode: "supabase" | "demo" = "supabase";
vi.mock("./session", () => ({
  requireActionSession: async (perm: string) => (held.has(perm) ? { mode, client: mode === "demo" ? null : client, branchId: "branch-1", permissions: held } : null),
}));

import { adjustStockAction, updateItemAction } from "./catalog-actions";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  calls.length = 0;
  held = new Set();
  mode = "supabase";
  state.current = { selling_price: "1299.00", mrp: null };
  state.updateResult = { data: [{ id: "x" }], error: null };
  state.rpcError = null;
});
const wrote = () => calls.filter((c) => c.table).map((c) => c.patch);

describe("updateItemAction: permissions are checked on the server, per group", () => {
  it("a user with no catalogue permission (a cashier) is refused and nothing is written", async () => {
    held = new Set(["sale.create"]);
    for (const input of [{ pricePaise: 100 }, { isActive: false }, { mrpPaise: 100 }, { reorderLevel: 3 }]) {
      const r = await updateItemAction({ kind: "VARIANT", id: ID, ...input });
      expect(r.ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });
  it("a manager with product.edit but NOT product.price_edit can change availability and the reorder level, but not price or MRP", async () => {
    held = new Set(["product.edit"]);
    expect((await updateItemAction({ kind: "VARIANT", id: ID, isActive: false, reorderLevel: 4 })).ok).toBe(true);
    expect(wrote()).toEqual([{ is_active: false, reorder_level: 4 }]);
    calls.length = 0;
    expect((await updateItemAction({ kind: "VARIANT", id: ID, pricePaise: 150000 })).ok).toBe(false);
    expect((await updateItemAction({ kind: "VARIANT", id: ID, mrpPaise: 150000 })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it("a request that mixes price and availability needs BOTH permissions", async () => {
    held = new Set(["product.price_edit"]);
    expect((await updateItemAction({ kind: "VARIANT", id: ID, pricePaise: 150000, isActive: false })).ok).toBe(false);
    expect(calls).toEqual([]);
    held = new Set(["product.price_edit", "product.edit"]);
    expect((await updateItemAction({ kind: "VARIANT", id: ID, pricePaise: 150000, isActive: false })).ok).toBe(true);
    expect(wrote()).toEqual([{ selling_price: 1500, is_active: false }]);
  });
  it("the demo has no database: it explains instead of pretending to save", async () => {
    held = new Set(["product.edit"]);
    mode = "demo";
    const r = await updateItemAction({ kind: "VARIANT", id: ID, isActive: false });
    expect(r).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

describe("updateItemAction: validation", () => {
  beforeEach(() => (held = new Set(["product.price_edit", "product.edit"])));
  it("rejects empty, unknown and malformed input", async () => {
    for (const bad of [{}, { kind: "VARIANT", id: "not-a-uuid", pricePaise: 1 }, { kind: "VARIANT", id: ID }, { kind: "VARIANT", id: ID, pricePaise: -1 }, { kind: "VARIANT", id: ID, pricePaise: 1.5 }, { kind: "VARIANT", id: ID, reorderLevel: -1 }, { kind: "VARIANT", id: ID, reorderLevel: 2.5 }, { kind: "VARIANT", id: ID, stock: 99 }, { kind: "VARIANT", id: ID, isActive: true, onHand: 50 }, null, "x"]) {
      expect((await updateItemAction(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(calls).toEqual([]);
  });
  it("stock can never be changed through this action (only inventory_adjust may)", async () => {
    expect((await updateItemAction({ kind: "VARIANT", id: ID, isActive: true, stock: 99 })).ok).toBe(false);
    expect((await updateItemAction({ kind: "VARIANT", id: ID, isActive: true, on_hand: 99 })).ok).toBe(false);
  });
  it("jewellery has no MRP or reorder level, and its price/availability go through the validated function", async () => {
    expect((await updateItemAction({ kind: "JEWELLERY", id: ID, mrpPaise: 100 })).ok).toBe(false);
    expect((await updateItemAction({ kind: "JEWELLERY", id: ID, reorderLevel: 2 })).ok).toBe(false);
    expect(calls).toEqual([]);
    expect((await updateItemAction({ kind: "JEWELLERY", id: ID, pricePaise: 250000, isActive: true })).ok).toBe(true);
    expect(calls).toEqual([{ rpc: ["catalog_update_jewellery", { p_item: ID, p_price_paise: 250000, p_is_active: true }] }]);
  });
  it("MRP below the selling price is refused with a clear message, before anything is written", async () => {
    const r = await updateItemAction({ kind: "VARIANT", id: ID, mrpPaise: 100000 }); // current price 1299.00
    expect(r).toMatchObject({ ok: false, field: "mrp" });
    if (!r.ok) expect(r.message).toMatch(/MRP cannot be lower/);
    expect(wrote()).toEqual([]);
  });
  it("raising the price above an existing MRP is refused too (the pair must stay consistent)", async () => {
    state.current = { selling_price: "1000.00", mrp: "1200.00" };
    expect((await updateItemAction({ kind: "VARIANT", id: ID, pricePaise: 150000 })).ok).toBe(false);
    expect(wrote()).toEqual([]);
    expect((await updateItemAction({ kind: "VARIANT", id: ID, pricePaise: 150000, mrpPaise: 200000 })).ok).toBe(true);
    expect(wrote()).toEqual([{ selling_price: 1500, mrp: 2000 }]);
  });
  it("MRP and reorder level can be cleared with null", async () => {
    expect((await updateItemAction({ kind: "VARIANT", id: ID, mrpPaise: null, reorderLevel: null })).ok).toBe(true);
    expect(wrote()).toEqual([{ mrp: null, reorder_level: null }]);
  });
  it("an item that does not exist is reported, not silently ignored", async () => {
    state.current = null;
    expect(await updateItemAction({ kind: "VARIANT", id: ID, mrpPaise: 200000 })).toMatchObject({ ok: false });
  });
});

describe("updateItemAction: database outcomes", () => {
  beforeEach(() => (held = new Set(["product.price_edit", "product.edit"])));
  it("never reports success when row-level security hid or refused the row (zero rows updated)", async () => {
    state.updateResult = { data: [], error: null };
    const r = await updateItemAction({ kind: "VARIANT", id: ID, isActive: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/role cannot do this/);
  });
  it("maps database errors to plain messages and never leaks the raw error", async () => {
    state.updateResult = { data: null, error: { message: 'duplicate key value violates unique constraint "secret_internal_name"', code: "23505" } };
    const r = await updateItemAction({ kind: "VARIANT", id: ID, isActive: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/secret_internal_name|constraint|23505/);
    state.updateResult = { data: null, error: { message: "permission denied for table product_variants", code: "42501" } };
    const r2 = await updateItemAction({ kind: "VARIANT", id: ID, isActive: false });
    if (!r2.ok) expect(r2.message).toMatch(/role cannot do this/);
  });
});

describe("adjustStockAction: only the inventory function changes stock", () => {
  const input = { idempotencyKey: "22222222-2222-4222-8222-222222222222", variantId: ID, delta: 3, reason: "FOUND" };
  it("needs inventory.adjust; a manager without it is refused and nothing is called", async () => {
    held = new Set(["product.edit", "product.price_edit"]);
    expect((await adjustStockAction(input)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it("calls the inventory_adjust function with the branch from the SERVER session, not from the request", async () => {
    held = new Set(["inventory.adjust"]);
    const r = await adjustStockAction({ ...input, branchId: "evil-branch" } as never);
    expect(r.ok).toBe(false); // unknown keys are rejected (strict)
    const ok = await adjustStockAction(input);
    expect(ok).toMatchObject({ ok: true, data: { balanceAfter: 7 } });
    expect(calls).toEqual([{ rpc: ["inventory_adjust", { p_branch: "branch-1", p_variant: ID, p_delta: 3, p_reason_code: "FOUND", p_note: null, p_idempotency_key: input.idempotencyKey }] }]);
    expect(calls.some((c) => c.table)).toBe(false); // no direct table write
  });
  it("refuses zero, out-of-range and unknown reasons; reports a negative-stock refusal from the database", async () => {
    held = new Set(["inventory.adjust"]);
    for (const bad of [{ ...input, delta: 0 }, { ...input, delta: 1_000_000 }, { ...input, reason: "FREE_STUFF" }, { ...input, variantId: "x" }]) expect((await adjustStockAction(bad)).ok).toBe(false);
    expect(calls).toEqual([]);
    state.rpcError = { message: "INSUFFICIENT_STOCK" };
    const r = await adjustStockAction({ ...input, delta: -50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/below zero/);
  });
});
