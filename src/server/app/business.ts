import "server-only";
import type { Business } from "@/components/billing/receipt";
import type { AppSession } from "./session";

/**
 * Business details that appear on receipts. Only what the shop has actually entered is returned;
 * nothing is invented. In demo mode the name says so.
 */
export async function getBusiness(s: AppSession): Promise<Business> {
  if (s.mode === "demo" || !s.client) return { name: s.tenantName, branch: s.branchName, gstin: null };
  const { data } = await s.client.from("tenants").select("trade_name, gstin").eq("id", s.tenantId).maybeSingle();
  return {
    name: (data?.trade_name as string | undefined) ?? s.tenantName,
    branch: s.branchName,
    gstin: (data?.gstin as string | null | undefined) ?? null,
  };
}
