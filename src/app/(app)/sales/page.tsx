import Link from "next/link";
import { Download, Receipt, Search } from "lucide-react";
import { formatINR } from "@/domain/money";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/components/billing/receipt";
import { requireSession } from "@/server/app/session";
import { listSales } from "@/server/app/sales";

export const metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

const LABEL = { CASH: "Cash", UPI: "UPI", CARD: "Card" } as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const s = await requireSession("/sales");
  const { q = "", status = "all" } = await searchParams;
  let rows;
  try {
    rows = await listSales(s, q);
  } catch {
    return (
      <Banner tone="error" title="Sales could not be loaded.">
        Check the internet connection and refresh the page.
      </Banner>
    );
  }
  const scope = s.permissions.has("sale.view_history") ? "all sales" : "today's sales";

  return (
    <div className="flex flex-col gap-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Sales</h1>
          <p className="text-xs text-slate-500">
            Showing {scope} for {s.branchName}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 shadow-2xs transition-colors"
        >
          <Download size={15} />
          <span>Export</span>
        </button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {[
              { id: "all", label: "All" },
              { id: "completed", label: "Completed" },
              { id: "draft", label: "Draft" },
              { id: "returns", label: "Returns" },
            ].map((tab) => {
              const active = status === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={`/sales?status=${tab.id}${q ? `&q=${q}` : ""}`}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    active ? "bg-teal-50 text-[#00bba7] border border-teal-200 shadow-2xs" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>

          <form method="get" className="flex items-center gap-2" role="search">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search invoice number..."
                aria-label="Search by invoice number"
                className="bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#00bba7] w-60"
              />
            </div>
            <button className="bg-[#00bba7] hover:bg-[#009688] text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors" type="submit">
              Search
            </button>
          </form>
        </div>
      </div>

      {/* Table & Empty State */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Receipt aria-hidden size={32} />}
          title={q ? "No bill matches that number" : "No bills yet"}
          description={q ? "Check the number and try again." : "Bills appear here as soon as they are completed."}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                <th className="p-3.5">Invoice</th>
                <th className="p-3.5">Date &amp; Time</th>
                <th className="p-3.5">Customer</th>
                <th className="p-3.5">Payment</th>
                <th className="p-3.5 text-right">Total</th>
                <th className="p-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3.5">
                    <Link className="font-bold text-[#00bba7] hover:underline" href={`/sales/${r.id}`}>
                      {r.invoiceNumber}
                    </Link>
                  </td>
                  <td className="p-3.5 text-slate-500">{formatDateTime(r.issuedAt)}</td>
                  <td className="p-3.5 text-slate-600">Walk-in</td>
                  <td className="p-3.5 font-semibold text-slate-700">
                    {r.methods.length ? r.methods.map((m) => LABEL[m]).join(" + ") : "Cash"}
                  </td>
                  <td className="p-3.5 text-right font-extrabold text-slate-900">{formatINR(r.grandTotalPaise)}</td>
                  <td className="p-3.5">
                    {r.status === "VOIDED" ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-600 border border-red-200">Voided</span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">Completed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

