import Link from "next/link";
import { Receipt } from "lucide-react";
import { formatINR } from "@/domain/money";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/components/billing/receipt";
import { requireSession } from "@/server/app/session";
import { listSales } from "@/server/app/sales";

export const metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

const LABEL = { CASH: "Cash", UPI: "UPI", CARD: "Card" } as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession("/sales");
  const { q = "" } = await searchParams;
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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sales</h1>
        <p className="text-muted">
          Showing {scope} for {s.branchName}.
        </p>
      </div>
      <form method="get" className="flex gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by invoice number"
          aria-label="Search by invoice number"
          className="min-h-11 w-full max-w-sm rounded-ctl border border-line bg-surface px-3"
        />
        <button className="min-h-11 rounded-ctl bg-primary px-4 font-semibold hover:bg-primary-strong" type="submit">
          Search
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Receipt aria-hidden size={32} />}
          title={q ? "No bill matches that number" : "No bills yet"}
          description={q ? "Check the number and try again." : "Bills appear here as soon as they are completed."}
        />
      ) : (
        <div className="overflow-x-auto rounded-ctl border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="border-b border-line bg-app text-sm text-muted">
              <tr>
                <th className="p-3">Invoice</th>
                <th className="p-3">Date and time</th>
                <th className="p-3">Paid by</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-b-0">
                  <td className="p-3">
                    <Link className="font-semibold text-primary-strong underline" href={`/sales/${r.id}`}>
                      {r.invoiceNumber}
                    </Link>
                    {r.status === "VOIDED" ? (
                      <span className="ml-2 rounded bg-danger-bg px-2 py-0.5 text-sm text-danger">Voided</span>
                    ) : null}
                  </td>
                  <td className="p-3">{formatDateTime(r.issuedAt)}</td>
                  <td className="p-3">{r.methods.length ? r.methods.map((m) => LABEL[m]).join(" + ") : "—"}</td>
                  <td className="p-3 text-right font-semibold">{formatINR(r.grandTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
