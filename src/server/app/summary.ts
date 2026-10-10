import "server-only";
import { getEngine } from "../billing/store";
import type { AppSession } from "./session";

export interface Summary {
  invoiceCount: number;
  grandTotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  byMethod: Record<string, number>;
}

/** Today's date in India, as YYYY-MM-DD. */
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const isoDate = (v: unknown, fallback: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);

/** Totals for the active branch. Computed by the database from the immutable invoices. */
export async function salesSummary(s: AppSession, from: string, to: string): Promise<Summary | null> {
  if (s.mode === "demo") {
    const inv = getEngine().invoices;
    const byMethod: Record<string, number> = {};
    for (const i of inv) for (const p of i.payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountPaise;
    return { invoiceCount: inv.length, grandTotalPaise: inv.reduce((n, i) => n + i.grandTotalPaise, 0), discountPaise: inv.reduce((n, i) => n + i.lines.reduce((m, l) => m + l.discountPaise, 0), 0), taxPaise: 0, byMethod };
  }
  const { data, error } = await s.client!.rpc("report_sales_summary", { p_branch: s.branchId, p_from: from, p_to: to });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    invoiceCount: Number(d.invoiceCount ?? 0),
    grandTotalPaise: Number(d.grandTotalPaise ?? 0),
    discountPaise: Number(d.discountPaise ?? 0),
    taxPaise: Number(d.taxPaise ?? 0),
    byMethod: (d.byMethod as Record<string, number>) ?? {},
  };
}

export async function setupStatus(s: AppSession): Promise<{ products: number | null; taxEnforced: boolean | null; gstinSet: boolean | null }> {
  if (s.mode === "demo" || !s.client) return { products: null, taxEnforced: null, gstinSet: null };
  const db = s.client;
  const [v, i, t, ts] = await Promise.all([
    db.from("product_variants").select("id", { count: "exact", head: true }),
    db.from("jewellery_items").select("id", { count: "exact", head: true }).eq("branch_id", s.branchId),
    db.from("tenants").select("gstin").eq("id", s.tenantId).maybeSingle(),
    db.from("tenant_settings").select("tax_enforced").eq("tenant_id", s.tenantId).maybeSingle(),
  ]);
  return {
    products: (v.count ?? 0) + (i.count ?? 0),
    taxEnforced: ts.data ? Boolean(ts.data.tax_enforced) : null,
    gstinSet: t.data ? Boolean(t.data.gstin) : null,
  };
}
