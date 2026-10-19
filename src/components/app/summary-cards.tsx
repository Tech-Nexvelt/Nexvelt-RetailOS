import { formatINR } from "@/domain/money";
import type { Summary } from "@/server/app/summary";
import { ArrowUpRight, TrendingUp } from "lucide-react";

const LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card" };

export function SummaryCards({ summary, title }: { summary: Summary; title: string }) {
  const methods = Object.entries(summary.byMethod);
  const avgBillPaise = summary.invoiceCount > 0 ? Math.round(summary.grandTotalPaise / summary.invoiceCount) : 0;

  return (
    <section aria-label={title} className="flex flex-col gap-5">
      {/* 4 KPI Top Cards */}
      <dl className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-semibold text-slate-500">Today's Sales</dt>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600 border border-emerald-100">
              <ArrowUpRight size={12} /> +12%
            </span>
          </div>
          <dd className="text-2xl font-extrabold text-slate-900 mt-2" data-testid="sales-total">
            {formatINR(summary.grandTotalPaise)}
          </dd>
          <p className="text-[11px] text-slate-400 mt-1">vs yesterday</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-semibold text-slate-500">Total Bills</dt>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600 border border-emerald-100">
              <ArrowUpRight size={12} /> +8%
            </span>
          </div>
          <dd className="text-2xl font-extrabold text-slate-900 mt-2" data-testid="bill-count">
            {summary.invoiceCount}
          </dd>
          <p className="text-[11px] text-slate-400 mt-1">bills completed</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-semibold text-slate-500">Avg. Bill Value</dt>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              -2%
            </span>
          </div>
          <dd className="text-2xl font-extrabold text-slate-900 mt-2">
            {formatINR(avgBillPaise)}
          </dd>
          <p className="text-[11px] text-slate-400 mt-1">per completed bill</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-semibold text-slate-500">Low Stock Items</dt>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-600 border border-amber-200">
              Alerts
            </span>
          </div>
          <dd className="text-2xl font-extrabold text-amber-600 mt-2">5</dd>
          <p className="text-[11px] text-slate-400 mt-1">needs reorder</p>
        </div>
      </dl>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Sales Trend Vector SVG Line Chart */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Sales Trend</h3>
              <p className="text-xs text-slate-500">Hourly revenue breakdown</p>
            </div>
            <TrendingUp className="text-[#00bba7]" size={20} />
          </div>

          <div className="h-44 w-full relative">
            <svg viewBox="0 0 500 150" className="w-full h-full overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00bba7" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#00bba7" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path
                d="M0,120 Q50,110 100,80 T200,60 T300,90 T400,40 T500,50 L500,150 L0,150 Z"
                fill="url(#salesGrad)"
              />
              <path
                d="M0,120 Q50,110 100,80 T200,60 T300,90 T400,40 T500,50"
                fill="none"
                stroke="#00bba7"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <div className="flex justify-between text-[11px] font-semibold text-slate-400 pt-2 border-t border-slate-100">
            <span>9 AM</span>
            <span>11 AM</span>
            <span>1 PM</span>
            <span>3 PM</span>
            <span>5 PM</span>
            <span>7 PM</span>
            <span>9 PM</span>
          </div>
        </div>

        {/* Payment Breakdown Donut Visual */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <h3 className="font-bold text-slate-900 text-sm mb-3">Payment Breakdown</h3>

          <div className="flex items-center justify-center my-2 relative">
            <svg viewBox="0 0 100 100" className="w-32 h-32 -rotate-90">
              <circle cx="50" cy="50" r="40" stroke="#f1f5f9" strokeWidth="12" fill="none" />
              {/* Cash Segment */}
              <circle cx="50" cy="50" r="40" stroke="#00bba7" strokeWidth="12" fill="none" strokeDasharray="105 251" strokeDashoffset="0" />
              {/* UPI Segment */}
              <circle cx="50" cy="50" r="40" stroke="#0284c7" strokeWidth="12" fill="none" strokeDasharray="95 251" strokeDashoffset="-105" />
              {/* Card Segment */}
              <circle cx="50" cy="50" r="40" stroke="#8b5cf6" strokeWidth="12" fill="none" strokeDasharray="40 251" strokeDashoffset="-200" />
            </svg>
            <div className="absolute text-center">
              <p className="text-xs font-bold text-slate-900">₹1.24L</p>
              <p className="text-[10px] text-slate-400">Total</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-medium text-slate-600 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#00bba7]" />
              <span>Cash 42%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-600" />
              <span>UPI 38%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              <span>Card 16%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
              <span>Others 4%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown detail list */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Money Received Details</p>
        {methods.length === 0 ? (
          <p className="text-xs text-slate-400">No recorded payments for this date range.</p>
        ) : (
          <ul className="flex flex-wrap gap-6 text-xs font-semibold text-slate-700">
            {methods.map(([m, paise]) => (
              <li key={m} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <span className="text-slate-500">{LABEL[m] ?? m}:</span>
                <strong className="text-slate-900 font-extrabold">{formatINR(paise)}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

