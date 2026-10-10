import "server-only";
import { cookies } from "next/headers";
import type { Role } from "@/domain/navigation";
import { can } from "@/domain/navigation";

/**
 * DEMO IDENTITY. Real authentication (Supabase Auth + memberships + RLS) arrives in Phase 2.
 * Until then the role comes from a plain cookie so the role-based navigation can be exercised.
 * It must be replaced before any real deployment. As a safety net, `switchDemoRole` does nothing
 * when NODE_ENV is "production" and the role then defaults to the least-privileged one (cashier).
 */
const ROLES: Role[] = ["owner", "manager", "cashier"];
export const ROLE_COOKIE = "nv_demo_role";

export async function getCurrentRole(): Promise<Role> {
  const value = (await cookies()).get(ROLE_COOKIE)?.value;
  return ROLES.find((r) => r === value) ?? "cashier";
}

export async function requirePermission(permission: string): Promise<boolean> {
  return can(await getCurrentRole(), permission);
}

export function isRole(value: unknown): value is Role {
  return ROLES.some((r) => r === value);
}
