import Link from "next/link";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { SummaryCards } from "@/components/app/summary-cards";
import { requireSession } from "@/server/app/session";
import { salesSummary, setupStatus, todayIST } from "@/server/app/summary";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const s = await requireSession("/dashboard");
  const today = todayIST();
  const [summary, setup] = await Promise.all([salesSummary(s, today, today), setupStatus(s)]);
  const checks: { ok: boolean | null; text: string; href: string }[] = [
    { ok: setup.products === null ? null : setup.products > 0, text: "Products added", href: "/products/new" },
    { ok: setup.taxEnforced === null ? null : setup.taxEnforced === false, text: "Tax decision made (billing is blocked until you choose)", href: "/settings" },
    { ok: setup.gstinSet, text: "GSTIN entered (only once NR Collections has confirmed it)", href: "/settings" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Today at {s.branchName}</h1>
        <p className="text-muted">{today}</p>
      </div>
      {summary ? <SummaryCards summary={summary} title="Today's sales" /> : <Banner tone="error" title="Today's sales could not be loaded.">Refresh the page. If it keeps happening, check the internet connection.</Banner>}
      {s.mode === "supabase" ? (
        <section aria-label="Setup" className="flex max-w-xl flex-col gap-2">
          <h2 className="text-lg font-semibold">Before the first real sale</h2>
          <ul className="rounded-ctl border border-line bg-surface">
            {checks.map((c) => (
              <li key={c.text} className="flex items-center gap-3 border-b border-line p-3 last:border-b-0">
                {c.ok ? <CheckCircle2 aria-hidden className="text-success" size={20} /> : <CircleAlert aria-hidden className="text-warning" size={20} />}
                <Link href={c.href} className="underline">{c.text}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <nav aria-label="Shortcuts" className="flex flex-wrap gap-2">
        <Link href="/billing" className="inline-flex min-h-12 items-center rounded-ctl bg-primary px-5 text-lg font-semibold hover:bg-primary-strong">Start billing</Link>
        <Link href="/sales" className="inline-flex min-h-12 items-center rounded-ctl border border-line bg-surface px-5 text-lg">Sales</Link>
        <Link href="/products" className="inline-flex min-h-12 items-center rounded-ctl border border-line bg-surface px-5 text-lg">Products</Link>
      </nav>
    </div>
  );
}
