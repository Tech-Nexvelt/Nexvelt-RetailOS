"use server";

import { z } from "zod";
import { requireActionSession, type AppSession } from "./session";
import { dbCode } from "./db-errors";
import { catalogMessage } from "@/domain/catalog";
import { inviteStaff, type AdminAuth, type RpcCaller } from "../auth/service";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SettingsState {
  ok?: boolean;
  message?: string;
}
const NOT_ALLOWED: SettingsState = { ok: false, message: "Your role cannot change this. Ask the owner." };
const DEMO: SettingsState = { ok: false, message: "Settings need the real database. This is the demo." };

type Owner = { ok: true; s: AppSession } | { ok: false; error: SettingsState };
async function owner(permission: string): Promise<Owner> {
  const s = await requireActionSession(permission);
  if (!s) return { ok: false, error: NOT_ALLOWED };
  if (s.mode === "demo" || !s.client) return { ok: false, error: DEMO };
  return { ok: true, s };
}

const GSTIN = /^[0-9]{2}[A-Z0-9]{13}$/;

/** Business details printed on receipts. Only what the shop types here is ever printed. */
export async function saveBusinessAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const o = await owner("settings.manage");
  if (!o.ok) return o.error;
  const parsed = z
    .object({ tradeName: z.string().trim().min(1).max(120), legalName: z.string().trim().min(1).max(120), gstin: z.string().trim().toUpperCase().max(15) })
    .safeParse({ tradeName: form.get("tradeName"), legalName: form.get("legalName"), gstin: form.get("gstin") ?? "" });
  if (!parsed.success) return { ok: false, message: "Enter the shop name and legal name." };
  if (parsed.data.gstin && !GSTIN.test(parsed.data.gstin)) {
    return { ok: false, message: "That GSTIN is not in the right format (15 letters and digits). Leave it blank until NR Collections confirms it." };
  }
  const { data, error } = await o.s.client!
    .from("tenants")
    .update({ trade_name: parsed.data.tradeName, legal_name: parsed.data.legalName, gstin: parsed.data.gstin || null })
    .eq("id", o.s.tenantId)
    .select("id");
  if (error || !data?.length) return { ok: false, message: catalogMessage(error ? dbCode(error) : "FORBIDDEN") };
  return { ok: true, message: "Saved." };
}

/**
 * Tax mode. There are exactly two honest choices today:
 *  - "none":   bill without tax. Bills say "not a GST tax invoice". For use only until NR Collections
 *              has confirmed its tax setup.
 *  - "blocked": billing refuses to run until tax is configured (the safe default).
 * Configuring real tax classes and rates is deliberately not offered yet: the rates have not been confirmed.
 */
export async function setTaxModeAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const o = await owner("settings.manage");
  if (!o.ok) return o.error;
  const mode = form.get("mode");
  if (mode !== "none" && mode !== "blocked") return { ok: false, message: "Choose one of the two options." };
  if (mode === "none" && form.get("understand") !== "on") {
    return { ok: false, message: "Tick the box to confirm you understand these bills are not GST tax invoices." };
  }
  const { data, error } = await o.s.client!
    .from("tenant_settings")
    .update({ tax_enforced: mode === "blocked" })
    .eq("tenant_id", o.s.tenantId)
    .select("tenant_id");
  if (error || !data?.length) return { ok: false, message: catalogMessage(error ? dbCode(error) : "FORBIDDEN") };
  return { ok: true, message: mode === "none" ? "Billing without tax is on. Bills are marked as not a GST tax invoice." : "Billing is blocked until tax is set up." };
}

/** Invite a cashier into the current branch. The role is fixed here; the database checks the inviter again. */
export async function inviteCashierAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const s = await requireActionSession("staff.manage");
  if (!s) return NOT_ALLOWED;
  if (s.mode === "demo" || !s.client) return DEMO;
  const env = publicEnv();
  if (!env) return { ok: false, message: "The server is not configured to send invitations yet." };
  const admin = createAdminClient();
  const r = await inviteStaff({
    ctx: s.ctx,
    admin: admin ? (admin.auth.admin as unknown as AdminAuth) : null,
    userClient: s.client as unknown as RpcCaller,
    siteUrl: env.siteUrl,
    input: {
      tenantId: s.tenantId,
      email: form.get("email"),
      fullName: form.get("fullName"),
      tenantRole: "tenant_member",
      branchRoles: [{ branchId: s.branchId, role: "cashier" }],
    },
  });
  return { ok: r.ok, message: r.ok ? r.message : r.message };
}

/**
 * Allow or stop one cashier from seeing TODAY'S bills in this branch (the sale.view exception).
 * Only people with roles.manage (the owner) can do this; the database checks it again.
 */
export async function setSalesAccessAction(userId: string, enabled: boolean): Promise<SettingsState> {
  const o = await owner("roles.manage");
  if (!o.ok) return o.error;
  if (!z.uuid().safeParse(userId).success) return { ok: false, message: "Unknown person." };
  const db = o.s.client!;
  const { error } = enabled
    ? await db.rpc("permission_override_set", {
        p_tenant: o.s.tenantId, p_user: userId, p_branch: o.s.branchId, p_permission: "sale.view",
        p_effect: "GRANT", p_reason: "Owner allows this cashier to see today's bills", p_expires_at: null,
      })
    : await db.rpc("permission_override_clear", { p_tenant: o.s.tenantId, p_user: userId, p_branch: o.s.branchId, p_permission: "sale.view" });
  if (error && !(error.message === "NOT_FOUND" && !enabled)) return { ok: false, message: catalogMessage(dbCode(error)) };
  return { ok: true, message: enabled ? "This cashier can now see today's bills." : "This cashier can no longer see bills." };
}
