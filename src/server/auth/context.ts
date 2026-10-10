/**
 * Who is the signed-in user and what may they do?
 *
 * This is built from the user's OWN rows (read through Row Level Security), never from anything the
 * user supplied at sign-up and never from JWT metadata. It is used for the first-gate checks and for
 * deciding what to show. The database re-checks every privileged operation, so a wrong answer here
 * can only hide or show a button; it can never grant access.
 */
export interface CounterInfo {
  id: string;
  code: string;
  name: string;
}
export interface TenantAccess {
  id: string;
  code: string;
  name: string;
  roleKey: string;
  permissions: string[];
}
export interface BranchAccess {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  permissions: string[];
  counters: CounterInfo[];
}
export interface AuthContext {
  userId: string;
  email: string | null;
  tenants: TenantAccess[];
  branches: BranchAccess[];
}

export interface ContextRows {
  userId: string;
  email: string | null;
  tenantMemberships: { tenant_id: string; role_id: string }[];
  branchMemberships: { branch_id: string; role_id: string }[];
  roles: { id: string; key: string }[];
  rolePermissions: { role_id: string; permission_key: string }[];
  tenants: { id: string; code: string; trade_name: string; status: string }[];
  branches: { id: string; tenant_id: string; code: string; name: string; status: string }[];
  counters: { id: string; branch_id: string; code: string; name: string; status: string }[];
  /** The user's own per-person exceptions (the database only returns these rows to them). */
  overrides?: {
    branch_id: string | null;
    permission_key: string;
    effect: "GRANT" | "DENY";
    expires_at: string | null;
  }[];
  /** Evaluation time for expiry; injectable for tests. */
  now?: Date;
}

/** Pure: turn rows into a context. Mirrors the database's permission semantics. */
export function buildContext(r: ContextRows): AuthContext {
  const roleKey = new Map(r.roles.map((x) => [x.id, x.key]));
  const permsOf = (roleId: string) =>
    r.rolePermissions.filter((p) => p.role_id === roleId).map((p) => p.permission_key);

  const now = r.now ?? new Date();
  const activeOverrides = (r.overrides ?? []).filter(
    (o) => !o.expires_at || new Date(o.expires_at) > now,
  );
  const tenants: TenantAccess[] = [];
  const tenantPerms = new Map<string, Set<string>>();
  for (const m of r.tenantMemberships) {
    const t = r.tenants.find((x) => x.id === m.tenant_id && x.status === "ACTIVE");
    if (!t) continue; // suspended or unknown tenants grant nothing
    const permissions = applyOverrides(
      permsOf(m.role_id),
      activeOverrides.filter((o) => o.branch_id === null),
    );
    tenantPerms.set(t.id, new Set(permissions));
    tenants.push({
      id: t.id,
      code: t.code,
      name: t.trade_name,
      roleKey: roleKey.get(m.role_id) ?? "",
      permissions,
    });
  }

  const branches: BranchAccess[] = [];
  for (const b of r.branches) {
    if (b.status !== "ACTIVE" || !tenantPerms.has(b.tenant_id)) continue;
    const bm = r.branchMemberships.find((x) => x.branch_id === b.id);
    // Same rule as the database: a branch is reachable through a branch membership, or through a
    // tenant role that carries branch-level permissions (the owner). A plain tenant member with
    // no branch role cannot see the branch.
    // Access is decided by ROLE defaults only; exceptions never create access.
    const roleDefaults = new Set<string>([
      ...permsOf(r.tenantMemberships.find((m) => m.tenant_id === b.tenant_id)?.role_id ?? ""),
    ]);
    const viaTenantRole = [...roleDefaults].some((p) => BRANCH_SCOPE.has(p));
    if (!bm && !viaTenantRole) continue;
    const base = new Set<string>(roleDefaults);
    for (const p of bm ? permsOf(bm.role_id) : []) base.add(p);
    // Then this branch's exceptions and the tenant-wide ones: GRANT adds, DENY removes, DENY wins.
    const perms = new Set<string>(
      applyOverrides(
        [...base],
        activeOverrides.filter((o) => o.branch_id === null || o.branch_id === b.id),
      ),
    );
    branches.push({
      id: b.id,
      tenantId: b.tenant_id,
      code: b.code,
      name: b.name,
      permissions: [...perms],
      counters: r.counters
        .filter((c) => c.branch_id === b.id && c.status === "ACTIVE")
        .map(({ id, code, name }) => ({ id, code, name })),
    });
  }
  return { userId: r.userId, email: r.email, tenants, branches };
}

/** GRANT adds a permission, DENY removes it, and DENY always wins. Mirrors the database. */
export function applyOverrides(
  base: string[],
  overrides: { permission_key: string; effect: "GRANT" | "DENY" }[],
): string[] {
  const out = new Set(base);
  for (const o of overrides) if (o.effect === "GRANT") out.add(o.permission_key);
  for (const o of overrides) if (o.effect === "DENY") out.delete(o.permission_key);
  return [...out];
}

/** Permissions evaluated inside one branch (matches permissions.scope = 'BRANCH' in the database). */
export const BRANCH_SCOPE = new Set([
  "sale.create",
  "sale.view",
  "sale.view_history",
  "sale.void",
  "sale.return",
  "payment.record",
  "payment.refund",
  "discount.apply",
  "discount.override",
  "cash_session.manage",
  "inventory.view",
  "inventory.adjust",
  "purchase.manage",
  "report.view",
  "report.export",
  "staff.manage",
]);

export function canInTenant(ctx: AuthContext, tenantId: string, permission: string): boolean {
  return ctx.tenants.some((t) => t.id === tenantId && t.permissions.includes(permission));
}

export function canInBranch(ctx: AuthContext, branchId: string, permission: string): boolean {
  return ctx.branches.some((b) => b.id === branchId && b.permissions.includes(permission));
}

/** Every permission the user holds anywhere, for deciding navigation and landing page. */
export function allPermissions(ctx: AuthContext): Set<string> {
  const out = new Set<string>();
  for (const t of ctx.tenants) for (const p of t.permissions) out.add(p);
  for (const b of ctx.branches) for (const p of b.permissions) out.add(p);
  return out;
}

export type BillingTarget =
  | { ok: true; branchId: string; counterId: string }
  | { ok: false; reason: "NO_BRANCH" | "BRANCH_NOT_SELECTED" | "NO_COUNTER" };

/**
 * Which branch and counter does this user bill at? A user with exactly one billing branch needs no
 * choice. With several, a preference (validated against what they may actually use) is required.
 */
export function pickBillingTarget(
  ctx: AuthContext,
  preferredBranchId?: string | null,
): BillingTarget {
  const eligible = ctx.branches.filter(
    (b) => b.permissions.includes("sale.create") && b.permissions.includes("payment.record"),
  );
  if (eligible.length === 0) return { ok: false, reason: "NO_BRANCH" };
  const chosen =
    eligible.length === 1 ? eligible[0] : eligible.find((b) => b.id === preferredBranchId);
  if (!chosen) return { ok: false, reason: "BRANCH_NOT_SELECTED" };
  const counter = chosen.counters[0];
  if (!counter) return { ok: false, reason: "NO_COUNTER" };
  return { ok: true, branchId: chosen.id, counterId: counter.id };
}

/** Minimal shape of the query builder we need, so the loader can be tested with a fake. */
export interface QueryClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
  from(table: string): {
    select(columns: string): PromiseLike<{ data: unknown[] | null; error: unknown }> & {
      eq(column: string, value: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
}

/** Load the context for the current session. Returns null when not signed in. */
export async function loadContext(client: QueryClient): Promise<AuthContext | null> {
  // getUser() asks the Auth server to validate the token; the cookie alone is never trusted.
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const userId = data.user.id;

  const read = async <T>(table: string, columns: string, eq?: [string, string]): Promise<T[]> => {
    const q = client.from(table).select(columns);
    const res = await (eq ? q.eq(eq[0], eq[1]) : q);
    if (res.error) throw new Error(`context query failed: ${table}`);
    return (res.data ?? []) as T[];
  };

  const [
    tenantMemberships,
    branchMemberships,
    roles,
    rolePermissions,
    tenants,
    branches,
    counters,
    overrides,
  ] = await Promise.all([
    // RLS also returns other members' rows to someone holding user.manage, so filter to this user.
    read<ContextRows["tenantMemberships"][number]>("tenant_memberships", "tenant_id, role_id", [
      "user_id",
      userId,
    ]),
    read<ContextRows["branchMemberships"][number]>("branch_memberships", "branch_id, role_id", [
      "user_id",
      userId,
    ]),
    read<ContextRows["roles"][number]>("roles", "id, key"),
    read<ContextRows["rolePermissions"][number]>("role_permissions", "role_id, permission_key"),
    read<ContextRows["tenants"][number]>("tenants", "id, code, trade_name, status"),
    read<ContextRows["branches"][number]>("branches", "id, tenant_id, code, name, status"),
    read<ContextRows["counters"][number]>("counters", "id, branch_id, code, name, status"),
    // The owner can read everyone's exceptions, so filter to this user explicitly.
    read<NonNullable<ContextRows["overrides"]>[number]>(
      "permission_overrides",
      "branch_id, permission_key, effect, expires_at",
      ["user_id", userId],
    ),
  ]);
  return buildContext({
    userId,
    email: data.user.email ?? null,
    tenantMemberships,
    branchMemberships,
    roles,
    rolePermissions,
    tenants,
    branches,
    counters,
    overrides,
  });
}
