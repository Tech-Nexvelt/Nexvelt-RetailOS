import { describe, expect, it } from "vitest";
import {
  allPermissions,
  applyOverrides,
  buildContext,
  canInBranch,
  canInTenant,
  loadContext,
  pickBillingTarget,
  type ContextRows,
  type QueryClient,
} from "./context";
import { ROLE_PERMISSIONS } from "@/domain/navigation";

// Role ids
const R = { owner: "r-owner", member: "r-member", manager: "r-manager", cashier: "r-cashier" };
const rolePermissions = [
  ...ROLE_PERMISSIONS.owner.map((p) => ({ role_id: R.owner, permission_key: p })),
  ...ROLE_PERMISSIONS.manager.map((p) => ({ role_id: R.manager, permission_key: p })),
  ...ROLE_PERMISSIONS.cashier.map((p) => ({ role_id: R.cashier, permission_key: p })),
];
const base = (over: Partial<ContextRows>): ContextRows => ({
  userId: "u1",
  email: "u1@test.local",
  tenantMemberships: [],
  branchMemberships: [],
  roles: [
    { id: R.owner, key: "tenant_owner" },
    { id: R.member, key: "tenant_member" },
    { id: R.manager, key: "branch_manager" },
    { id: R.cashier, key: "cashier" },
  ],
  rolePermissions,
  tenants: [{ id: "t1", code: "T1", trade_name: "Shop One", status: "ACTIVE" }],
  branches: [
    { id: "b1", tenant_id: "t1", code: "B1", name: "Main", status: "ACTIVE" },
    { id: "b2", tenant_id: "t1", code: "B2", name: "Second", status: "ACTIVE" },
  ],
  counters: [
    { id: "c1", branch_id: "b1", code: "C1", name: "Counter 1", status: "ACTIVE" },
    { id: "c2", branch_id: "b2", code: "C1", name: "Counter 1", status: "ACTIVE" },
  ],
  overrides: [],
  now: new Date("2026-10-10T10:00:00Z"),
  ...over,
});
const owner = base({ tenantMemberships: [{ tenant_id: "t1", role_id: R.owner }] });
const cashierB1 = base({
  tenantMemberships: [{ tenant_id: "t1", role_id: R.member }],
  branchMemberships: [{ branch_id: "b1", role_id: R.cashier }],
});

describe("buildContext", () => {
  it("gives the owner every branch and every permission", () => {
    const ctx = buildContext(owner);
    expect(ctx.branches.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(canInTenant(ctx, "t1", "roles.manage")).toBe(true);
    expect(canInBranch(ctx, "b2", "sale.void")).toBe(true);
  });

  it("limits a cashier to their branch and to the four default permissions", () => {
    const ctx = buildContext(cashierB1);
    expect(ctx.branches.map((b) => b.id)).toEqual(["b1"]);
    expect([...ctx.branches[0]!.permissions].sort()).toEqual([...ROLE_PERMISSIONS.cashier].sort());
    expect(canInBranch(ctx, "b2", "sale.create")).toBe(false);
    expect(canInTenant(ctx, "t1", "settings.manage")).toBe(false);
    expect(ctx.tenants[0]?.permissions).toEqual([]);
  });

  it("gives a plain tenant member with no branch role no branch access at all", () => {
    const ctx = buildContext(base({ tenantMemberships: [{ tenant_id: "t1", role_id: R.member }] }));
    expect(ctx.branches).toEqual([]);
    expect(allPermissions(ctx).size).toBe(0);
  });

  it("gives a user with no membership nothing", () => {
    const ctx = buildContext(base({}));
    expect(ctx.tenants).toEqual([]);
    expect(ctx.branches).toEqual([]);
  });

  it("ignores suspended tenants and inactive branches", () => {
    const suspended = buildContext({
      ...owner,
      tenants: [{ id: "t1", code: "T1", trade_name: "x", status: "SUSPENDED" }],
    });
    expect(suspended.tenants).toEqual([]);
    expect(suspended.branches).toEqual([]);
    const inactive = buildContext({
      ...owner,
      branches: owner.branches.map((b) => (b.id === "b2" ? { ...b, status: "INACTIVE" } : b)),
    });
    expect(inactive.branches.map((b) => b.id)).toEqual(["b1"]);
  });

  it("lists only active counters", () => {
    const ctx = buildContext({
      ...cashierB1,
      counters: [{ id: "c1", branch_id: "b1", code: "C1", name: "x", status: "INACTIVE" }],
    });
    expect(ctx.branches[0]?.counters).toEqual([]);
  });
});

describe("per-person exceptions (mirror of the database rules)", () => {
  const withOverride = (o: NonNullable<ContextRows["overrides"]>[number][]) =>
    buildContext({ ...cashierB1, overrides: o });

  it("GRANT adds a permission in that branch", () => {
    const ctx = withOverride([
      { branch_id: "b1", permission_key: "sale.view", effect: "GRANT", expires_at: null },
    ]);
    expect(canInBranch(ctx, "b1", "sale.view")).toBe(true);
  });

  it("DENY removes a default permission", () => {
    const ctx = withOverride([
      { branch_id: "b1", permission_key: "sale.create", effect: "DENY", expires_at: null },
    ]);
    expect(canInBranch(ctx, "b1", "sale.create")).toBe(false);
  });

  it("DENY wins over GRANT, including a tenant-wide DENY over a branch GRANT", () => {
    const ctx = withOverride([
      { branch_id: "b1", permission_key: "sale.view", effect: "GRANT", expires_at: null },
      { branch_id: null, permission_key: "sale.view", effect: "DENY", expires_at: null },
    ]);
    expect(canInBranch(ctx, "b1", "sale.view")).toBe(false);
  });

  it("ignores an expired exception", () => {
    const ctx = withOverride([
      {
        branch_id: "b1",
        permission_key: "sale.view",
        effect: "GRANT",
        expires_at: "2026-10-09T00:00:00Z",
      },
      {
        branch_id: "b1",
        permission_key: "sale.create",
        effect: "DENY",
        expires_at: "2026-10-09T00:00:00Z",
      },
    ]);
    expect(canInBranch(ctx, "b1", "sale.view")).toBe(false);
    expect(canInBranch(ctx, "b1", "sale.create")).toBe(true);
  });

  it("applies a branch exception only in that branch", () => {
    const manager = buildContext(
      base({
        tenantMemberships: [{ tenant_id: "t1", role_id: R.member }],
        branchMemberships: [
          { branch_id: "b1", role_id: R.manager },
          { branch_id: "b2", role_id: R.manager },
        ],
        overrides: [
          { branch_id: "b1", permission_key: "report.export", effect: "GRANT", expires_at: null },
        ],
      }),
    );
    expect(canInBranch(manager, "b1", "report.export")).toBe(true);
    expect(canInBranch(manager, "b2", "report.export")).toBe(false);
  });

  it("never creates access for someone who has no branch role", () => {
    const ctx = buildContext(
      base({
        tenantMemberships: [{ tenant_id: "t1", role_id: R.member }],
        overrides: [
          { branch_id: "b1", permission_key: "sale.create", effect: "GRANT", expires_at: null },
        ],
      }),
    );
    expect(ctx.branches).toEqual([]);
  });

  it("applyOverrides is order independent", () => {
    const a = applyOverrides(
      ["x"],
      [
        { permission_key: "x", effect: "GRANT" },
        { permission_key: "x", effect: "DENY" },
      ],
    );
    const b = applyOverrides(
      ["x"],
      [
        { permission_key: "x", effect: "DENY" },
        { permission_key: "x", effect: "GRANT" },
      ],
    );
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });
});

describe("pickBillingTarget", () => {
  it("picks the only billing branch and its first counter", () => {
    expect(pickBillingTarget(buildContext(cashierB1))).toEqual({
      ok: true,
      branchId: "b1",
      counterId: "c1",
    });
  });

  it("needs a valid choice when several branches can bill, and rejects one the user cannot use", () => {
    const both = buildContext(
      base({
        tenantMemberships: [{ tenant_id: "t1", role_id: R.member }],
        branchMemberships: [
          { branch_id: "b1", role_id: R.cashier },
          { branch_id: "b2", role_id: R.cashier },
        ],
      }),
    );
    expect(pickBillingTarget(both)).toEqual({ ok: false, reason: "BRANCH_NOT_SELECTED" });
    expect(pickBillingTarget(both, "b2")).toEqual({ ok: true, branchId: "b2", counterId: "c2" });
    expect(pickBillingTarget(both, "not-mine")).toEqual({
      ok: false,
      reason: "BRANCH_NOT_SELECTED",
    });
    // a cashier of b1 cannot choose b2 by sending its id
    expect(pickBillingTarget(buildContext(cashierB1), "b2")).toEqual({
      ok: true,
      branchId: "b1",
      counterId: "c1",
    });
  });

  it("refuses when the user cannot sell or cannot record payments", () => {
    expect(pickBillingTarget(buildContext(base({})))).toEqual({ ok: false, reason: "NO_BRANCH" });
    const noPay = buildContext({
      ...cashierB1,
      overrides: [
        { branch_id: "b1", permission_key: "payment.record", effect: "DENY", expires_at: null },
      ],
    });
    expect(pickBillingTarget(noPay)).toEqual({ ok: false, reason: "NO_BRANCH" });
  });

  it("reports a branch with no counter", () => {
    expect(pickBillingTarget(buildContext({ ...cashierB1, counters: [] }))).toEqual({
      ok: false,
      reason: "NO_COUNTER",
    });
  });
});

describe("loadContext", () => {
  function fakeClient(
    user: { id: string; email?: string } | null,
    tables: Record<string, unknown[]>,
  ) {
    const eqCalls: Array<[string, string, string]> = [];
    const client: QueryClient = {
      auth: {
        getUser: async () => ({ data: { user }, error: user ? null : { message: "no session" } }),
      },
      from: (table: string) => ({
        select: () => {
          const result = { data: tables[table] ?? [], error: null };
          const thenable = Object.assign(Promise.resolve(result), {
            eq: (col: string, val: string) => {
              eqCalls.push([table, col, val]);
              return Promise.resolve(result);
            },
          });
          return thenable as never;
        },
      }),
    };
    return { client, eqCalls };
  }

  it("returns null when there is no verified user (never falls back to anything)", async () => {
    expect(await loadContext(fakeClient(null, {}).client)).toBeNull();
  });

  it("asks only for the signed-in user's own memberships and exceptions", async () => {
    const { client, eqCalls } = fakeClient(
      { id: "u1", email: "u1@test.local" },
      {
        tenant_memberships: [{ tenant_id: "t1", role_id: R.cashier }],
        roles: [{ id: R.cashier, key: "cashier" }],
      },
    );
    const ctx = await loadContext(client);
    expect(ctx?.userId).toBe("u1");
    expect(eqCalls.sort()).toEqual([
      ["branch_memberships", "user_id", "u1"],
      ["permission_overrides", "user_id", "u1"],
      ["tenant_memberships", "user_id", "u1"],
    ]);
  });

  it("fails closed if a query errors", async () => {
    const client: QueryClient = {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
      from: () => ({
        select: () =>
          Object.assign(Promise.resolve({ data: null, error: { message: "boom" } }), {
            eq: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }) as never,
      }),
    };
    await expect(loadContext(client)).rejects.toThrow(/context query failed/);
  });
});
