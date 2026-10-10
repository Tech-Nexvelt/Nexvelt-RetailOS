import "server-only";
import type { AppSession } from "./session";

export interface StaffRow {
  userId: string;
  name: string;
  role: string;
  active: boolean;
  /** Has the owner allowed this person to see today's bills? */
  salesAccess: boolean;
}
export interface SettingsData {
  tradeName: string;
  legalName: string;
  gstin: string;
  /** null = could not be read (the person lacks settings.manage). */
  taxEnforced: boolean | null;
  staff: StaffRow[];
}

const ROLE_LABEL: Record<string, string> = { cashier: "Cashier", branch_manager: "Branch manager" };

export async function loadSettings(s: AppSession): Promise<SettingsData> {
  if (s.mode === "demo" || !s.client) {
    return { tradeName: s.tenantName, legalName: s.tenantName, gstin: "", taxEnforced: null, staff: [] };
  }
  const db = s.client;
  const [tenant, settings, members, roles, overrides] = await Promise.all([
    db.from("tenants").select("trade_name, legal_name, gstin").eq("id", s.tenantId).maybeSingle(),
    db.from("tenant_settings").select("tax_enforced").eq("tenant_id", s.tenantId).maybeSingle(),
    db.from("branch_memberships").select("user_id, role_id, status").eq("branch_id", s.branchId),
    db.from("roles").select("id, key"),
    db.from("permission_overrides").select("user_id, effect, expires_at").eq("branch_id", s.branchId).eq("permission_key", "sale.view"),
  ]);
  const ids = (members.data ?? []).map((m) => m.user_id as string);
  const profiles = ids.length ? await db.from("profiles").select("id, full_name").in("id", ids) : { data: [] as { id: string; full_name: string }[] };
  const roleKey = new Map((roles.data ?? []).map((r) => [r.id as string, r.key as string]));
  const nameOf = new Map((profiles.data ?? []).map((p) => [p.id as string, (p.full_name as string) || "(no name yet)"]));
  const now = Date.now();
  const granted = new Set(
    (overrides.data ?? [])
      .filter((o) => o.effect === "GRANT" && (!o.expires_at || new Date(o.expires_at as string).getTime() > now))
      .map((o) => o.user_id as string),
  );
  return {
    tradeName: (tenant.data?.trade_name as string) ?? s.tenantName,
    legalName: (tenant.data?.legal_name as string) ?? "",
    gstin: (tenant.data?.gstin as string | null) ?? "",
    taxEnforced: settings.error || !settings.data ? null : Boolean(settings.data.tax_enforced),
    staff: (members.data ?? []).map((m) => ({
      userId: m.user_id as string,
      name: nameOf.get(m.user_id as string) ?? "(unknown)",
      role: ROLE_LABEL[roleKey.get(m.role_id as string) ?? ""] ?? "Staff",
      active: m.status === "ACTIVE",
      salesAccess: granted.has(m.user_id as string),
    })),
  };
}
