import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { SummaryCards } from "@/components/app/summary-cards";
import { requireSession } from "@/server/app/session";
import { isoDate, salesSummary, todayIST } from "@/server/app/summary";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; preset?: string }> }) {
  const s = await requireSession("/reports");
  const q = await searchParams;
  const today = todayIST();
  const from = isoDate(q.from, today);
  const to = isoDate(q.to, today);
  const reversed = from > to;
  const summary = reversed ? null : await salesSummary(s, from, to);
  const preset = q.preset || "today";

  return (
    <div className="flex flex-col gap-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Reports</h1>
          <p className="text-xs text-slate-500">Sales for {s.branchName} · Real-time summary</p>
        </div>
      </div>

      {/* Time Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          {[
            { id: "today", label: "Today" },
            { id: "week", label: "This Week" },
            { id: "month", label: "This Month" },
            { id: "custom", label: "Custom" },
          ].map((item) => {
            const active = preset === item.id;
            return (
              <Link
                key={item.id}
                href={`/reports?preset=${item.id}`}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  active ? "bg-teal-50 text-[#00bba7] border border-teal-200 shadow-2xs" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <form method="get" className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            From
            <input type="date" name="from" defaultValue={from} className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            To
            <input type="date" name="to" defaultValue={to} className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800" />
          </label>
          <button type="submit" className="bg-[#00bba7] hover:bg-[#009688] text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors">
            Show
          </button>
        </form>
      </div>

      {summary ? (
        <SummaryCards summary={summary} title={`${from} to ${to}`} />
      ) : reversed ? (
        <Banner tone="error" title="The dates are the wrong way round.">The “From” date must be on or before the “To” date.</Banner>
      ) : (
        <Banner tone="error" title="This report could not be loaded.">Try a shorter date range or refresh.</Banner>
      )}
    </div>
  );
}

