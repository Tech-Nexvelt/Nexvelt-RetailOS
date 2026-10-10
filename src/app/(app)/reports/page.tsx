import { Banner } from "@/components/ui/banner";
import { SummaryCards } from "@/components/app/summary-cards";
import { requireSession } from "@/server/app/session";
import { isoDate, salesSummary, todayIST } from "@/server/app/summary";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession("/reports");
  const q = await searchParams;
  const today = todayIST();
  const from = isoDate(q.from, today);
  const to = isoDate(q.to, today);
  const reversed = from > to; // ISO dates compare correctly as strings; the database also rejects this range
  const summary = reversed ? null : await salesSummary(s, from, to);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted">Sales for {s.branchName}. Totals come straight from the saved bills.</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">From<input type="date" name="from" defaultValue={from} className="min-h-11 rounded-ctl border border-line bg-surface px-3" /></label>
        <label className="flex flex-col text-sm">To<input type="date" name="to" defaultValue={to} className="min-h-11 rounded-ctl border border-line bg-surface px-3" /></label>
        <button type="submit" className="min-h-11 rounded-ctl bg-primary px-4 font-semibold hover:bg-primary-strong">Show</button>
      </form>
      {summary ? (
        <SummaryCards summary={summary} title={`${from} to ${to}`} />
      ) : reversed ? (
        <Banner tone="error" title="The dates are the wrong way round.">The “From” date must be on or before the “To” date. Change one of them and press Show.</Banner>
      ) : (
        <Banner tone="error" title="This report could not be loaded.">The date range may be longer than a year, or the connection failed. Try a shorter range.</Banner>
      )}
      <p className="text-sm text-muted">Exports, stock valuation and tax reports are not part of this first release.</p>
    </div>
  );
}
