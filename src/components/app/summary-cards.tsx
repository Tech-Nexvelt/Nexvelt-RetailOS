import { formatINR } from "@/domain/money";
import type { Summary } from "@/server/app/summary";

const LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card" };

export function SummaryCards({ summary, title }: { summary: Summary; title: string }) {
  const methods = Object.entries(summary.byMethod);
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-ctl border border-line bg-surface p-4">
          <dt className="text-sm text-muted">Total sales</dt>
          <dd className="text-3xl font-bold" data-testid="sales-total">{formatINR(summary.grandTotalPaise)}</dd>
        </div>
        <div className="rounded-ctl border border-line bg-surface p-4">
          <dt className="text-sm text-muted">Bills</dt>
          <dd className="text-3xl font-bold" data-testid="bill-count">{summary.invoiceCount}</dd>
        </div>
        <div className="rounded-ctl border border-line bg-surface p-4">
          <dt className="text-sm text-muted">Discounts given</dt>
          <dd className="text-3xl font-bold">{formatINR(summary.discountPaise)}</dd>
        </div>
      </dl>
      <div className="rounded-ctl border border-line bg-surface p-4">
        <p className="text-sm text-muted">Money received, by how it was paid</p>
        {methods.length === 0 ? <p className="mt-1">Nothing yet.</p> : (
          <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
            {methods.map(([m, paise]) => <li key={m}><span className="text-muted">{LABEL[m] ?? m}</span> <strong>{formatINR(paise)}</strong></li>)}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">UPI and card amounts are what cashiers confirmed. They are not matched with bank statements by this software.</p>
      </div>
    </section>
  );
}
