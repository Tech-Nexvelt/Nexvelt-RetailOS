import "server-only";
import type { PaymentMethod } from "@/domain/billing";
import type { Paise } from "@/domain/money";
import type { ReceiptData } from "@/components/billing/receipt";
import { getEngine } from "../billing/store";
import { getBusiness } from "./business";
import type { AppSession } from "./session";

/** numeric(14,2) comes back as a JSON number with at most 2 decimals; rounding recovers exact paise. */
export const toPaise = (n: unknown): Paise => Math.round(Number(n) * 100);

export interface SaleRow {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  grandTotalPaise: Paise;
  status: "ISSUED" | "VOIDED";
  methods: PaymentMethod[];
}

/** Escape LIKE wildcards so a search for "100%" matches the text, not everything. */
export const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listSales(s: AppSession, query: string): Promise<SaleRow[]> {
  const q = query.trim().slice(0, 40);
  if (s.mode === "demo") {
    return getEngine()
      .invoices.filter((i) => !q || i.invoiceNumber.toLowerCase().includes(q.toLowerCase()))
      .map((i) => ({
        id: i.invoiceId,
        invoiceNumber: i.invoiceNumber,
        issuedAt: i.issuedAt,
        grandTotalPaise: i.grandTotalPaise,
        status: "ISSUED" as const,
        methods: [...new Set(i.payments.map((p) => p.method))],
      }))
      .reverse();
  }
  const db = s.client!;
  let req = db
    .from("invoices")
    .select("id, invoice_number, issued_at, grand_total, status")
    .eq("branch_id", s.branchId)
    .order("issued_at", { ascending: false })
    .limit(100);
  if (q) req = req.ilike("invoice_number", `%${escapeLike(q)}%`);
  const { data, error } = await req;
  if (error) throw new Error("Could not load sales.");
  const ids = (data ?? []).map((r) => r.id as string);
  const methodsBy = new Map<string, PaymentMethod[]>();
  if (ids.length) {
    const { data: pays } = await db
      .from("payments")
      .select("invoice_id, method")
      .eq("direction", "IN")
      .in("invoice_id", ids);
    for (const p of pays ?? []) {
      const list = methodsBy.get(p.invoice_id as string) ?? [];
      if (!list.includes(p.method as PaymentMethod)) list.push(p.method as PaymentMethod);
      methodsBy.set(p.invoice_id as string, list);
    }
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    invoiceNumber: r.invoice_number as string,
    issuedAt: r.issued_at as string,
    grandTotalPaise: toPaise(r.grand_total),
    status: r.status as "ISSUED" | "VOIDED",
    methods: methodsBy.get(r.id as string) ?? [],
  }));
}

/** Everything needed to show or reprint one bill, from the immutable snapshot rows. */
export async function loadReceipt(s: AppSession, id: string): Promise<ReceiptData | null> {
  const business = await getBusiness(s);
  if (s.mode === "demo") {
    const inv = getEngine().invoices.find((i) => i.invoiceId === id);
    if (!inv) return null;
    return {
      businessName: business.name,
      branchName: business.branch,
      gstin: null,
      invoiceNumber: inv.invoiceNumber,
      issuedAt: inv.issuedAt,
      lines: inv.lines,
      grandTotalPaise: inv.grandTotalPaise,
      taxTotalPaise: 0,
      taxConfigured: false,
      payments: inv.payments,
      changePaise: inv.changePaise,
      status: "ISSUED",
      duplicate: true,
    };
  }
  const db = s.client!;
  const { data: inv } = await db
    .from("invoices")
    .select("id, invoice_number, issued_at, grand_total, tax_total, change_total, tax_configured, status")
    .eq("id", id)
    .eq("branch_id", s.branchId)
    .maybeSingle();
  if (!inv) return null; // not found, or not visible to this person (row-level security)
  const [{ data: items }, { data: pays }] = await Promise.all([
    db
      .from("invoice_items")
      .select("line_no, description, code_snapshot, quantity, unit_price, discount_amount, line_total")
      .eq("invoice_id", id)
      .order("line_no"),
    db.from("payments").select("method, amount").eq("invoice_id", id).eq("direction", "IN"),
  ]);
  return {
    businessName: business.name,
    branchName: business.branch,
    gstin: business.gstin,
    invoiceNumber: inv.invoice_number as string,
    issuedAt: inv.issued_at as string,
    lines: (items ?? []).map((i) => ({
      name: i.description as string,
      detail: i.code_snapshot as string,
      quantity: i.quantity as number,
      unitPricePaise: toPaise(i.unit_price),
      discountPaise: toPaise(i.discount_amount),
      lineTotalPaise: toPaise(i.line_total),
    })),
    grandTotalPaise: toPaise(inv.grand_total),
    taxTotalPaise: inv.tax_configured ? toPaise(inv.tax_total) : 0,
    taxConfigured: Boolean(inv.tax_configured),
    payments: (pays ?? []).map((p) => ({ method: p.method as PaymentMethod, amountPaise: toPaise(p.amount) })),
    changePaise: toPaise(inv.change_total),
    status: inv.status as "ISSUED" | "VOIDED",
    duplicate: true,
  };
}
