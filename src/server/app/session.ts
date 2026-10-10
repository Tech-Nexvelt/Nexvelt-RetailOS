import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  canOpen,
  landingFor,
  NO_ACCESS,
  ROLE_PERMISSIONS,
  type PermissionSet,
} from "@/domain/navigation";
import { backendMode } from "@/lib/backend-mode";
import { createUserClient } from "@/lib/supabase/server";
import { loadContext, type AuthContext, type QueryClient } from "../auth/context";
import { getCurrentRole } from "../session";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What mode is the application in? The answer is explicit and never guessed:
 *  - "supabase": the real database, real sign-in (BILLING_BACKEND=supabase)
 *  - "demo":     in-memory fictitious data, no sign-in (BILLING_BACKEND=demo; development only)
 *  - "unconfigured": anything else. Every page refuses to show data. No silent fallback.
 */
export type AppMode = "supabase" | "demo" | "demo_forbidden" | "unconfigured";
export function appMode(): AppMode {
  return backendMode();
}

export interface AppSession {
  mode: "supabase" | "demo";
  userId: string;
  email: string | null;
  tenantId: string;
  tenantName: string;
  branchId: string;
  branchName: string;
  counterId: string | null;
  /** Permissions effective in the active branch (role defaults +/- this person's exceptions). */
  permissions: Set<string>;
  ctx: AuthContext;
  /** The signed-in user's own database client (Row Level Security applies). Null in demo mode. */
  client: SupabaseClient | null;
}

export const BRANCH_COOKIE = "nv_branch";

/** Resolve the current session, or null when there is no valid signed-in user. */
export const getAppSession = cache(async (): Promise<AppSession | null> => {
  const mode = appMode();
  if (mode !== "supabase" && mode !== "demo") return null;

  if (mode === "demo") {
    const role = await getCurrentRole();
    const perms = new Set(ROLE_PERMISSIONS[role]);
    const ctx: AuthContext = {
      userId: `demo-${role}`,
      email: `${role}@demo.invalid`,
      tenants: [{ id: "demo", code: "DEMO", name: "NR Collections (DEMO DATA)", roleKey: role, permissions: [] }],
      branches: [{ id: "B1", tenantId: "demo", code: "B1", name: "Demo branch", permissions: [...perms], counters: [{ id: "C1", code: "C1", name: "Counter 1" }] }],
    };
    return {
      mode: "demo", userId: ctx.userId, email: ctx.email, tenantId: "demo", tenantName: "NR Collections (DEMO DATA)",
      branchId: "B1", branchName: "Demo branch", counterId: "C1", permissions: perms, ctx, client: null,
    };
  }

  const client = await createUserClient();
  if (!client) return null;
  // getUser() validates the token with the Auth server on every request; the cookie alone is never trusted.
  const ctx = await loadContext(client as unknown as QueryClient);
  if (!ctx || ctx.tenants.length === 0) return ctx ? emptySession(ctx, client) : null;

  const wanted = (await cookies()).get(BRANCH_COOKIE)?.value;
  const branch = ctx.branches.find((b) => b.id === wanted) ?? ctx.branches[0];
  const tenant = ctx.tenants.find((t) => t.id === (branch?.tenantId ?? ctx.tenants[0]?.id)) ?? ctx.tenants[0]!;
  const permissions = new Set<string>([...tenant.permissions, ...(branch?.permissions ?? [])]);
  return {
    mode: "supabase", userId: ctx.userId, email: ctx.email, tenantId: tenant.id, tenantName: tenant.name,
    branchId: branch?.id ?? "", branchName: branch?.name ?? "", counterId: branch?.counters[0]?.id ?? null,
    permissions, ctx, client,
  };
});

function emptySession(ctx: AuthContext, client: SupabaseClient): AppSession {
  return {
    mode: "supabase", userId: ctx.userId, email: ctx.email, tenantId: "", tenantName: "", branchId: "",
    branchName: "", counterId: null, permissions: new Set(), ctx, client,
  };
}

/**
 * Use at the top of every protected page. Sends signed-out visitors to /login, and refuses (by
 * redirecting to an allowed screen) a signed-in user who is not allowed to open this path.
 * Nothing is rendered before this returns, so restricted data can never flash on screen.
 */
export async function requireSession(pathname: string): Promise<AppSession> {
  const mode = appMode();
  if (mode === "demo_forbidden") redirect("/login?error=demo");
  if (mode === "unconfigured") redirect("/login?error=config");
  const s = await getAppSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(pathname)}`);
  if (!canOpen(s.permissions, pathname)) {
    const home = landingFor(s.permissions);
    redirect(home === pathname ? NO_ACCESS : home);
  }
  return s;
}

/** For actions: the same checks, but report failure instead of redirecting. */
export async function requireActionSession(permission: string): Promise<AppSession | null> {
  const s = await getAppSession();
  if (!s || s.branchId === "" || !s.permissions.has(permission)) return null;
  return s;
}

export const has = (s: { permissions: PermissionSet }, p: string) =>
  Array.isArray(s.permissions) ? s.permissions.includes(p) : (s.permissions as ReadonlySet<string>).has(p);
