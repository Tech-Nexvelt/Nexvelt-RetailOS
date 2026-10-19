import { navForPermissions, OWNER_HOME, BILLING_HOME, landingFor } from "@/domain/navigation";
import { signOutAction } from "@/server/auth/actions";
import type { AppSession } from "@/server/app/session";
import Link from "next/link";
import { Bell, ChevronDown, LogOut, Plus, RotateCw, Store, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavLinks } from "./nav-links";
import { DemoRoleSwitcher } from "./demo-role-switcher";
import { ROLE_PERMISSIONS, type Role } from "@/domain/navigation";

/** The signed-in frame matching reference dark navbar & header */
export function AppShell({ session, children }: { session: AppSession; children: React.ReactNode }) {
  const items = navForPermissions(session.permissions);
  const home = landingFor(session.permissions);
  const demoRole = (Object.keys(ROLE_PERMISSIONS) as Role[]).find(
    (r) => `demo-${r}` === session.userId,
  );

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100 md:flex-row print:block">
      {/* Dark Left Sidebar */}
      <aside className="order-2 flex flex-col justify-between border-t border-slate-800 bg-[#0d1527] p-3 md:order-1 md:w-64 md:shrink-0 md:border-r md:border-t-0 md:p-4 print:hidden">
        <div className="flex flex-col gap-6">
          {/* Logo Header */}
          <div className="hidden px-2 pt-1 md:block">
            <Link
              href={home === OWNER_HOME || home === BILLING_HOME ? home : "/"}
              className="flex items-center gap-2.5 group"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00bba7] text-white shadow-md font-bold text-lg">
                <span className="leading-none">K</span>
              </div>
              <div className="flex flex-col">
                <span className="text-base font-bold tracking-tight text-white leading-tight">
                  NexVelt
                </span>
                <span className="text-xs font-semibold text-[#00bba7] leading-tight">
                  RetailOS
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation Items */}
          <NavLinks items={items} />
        </div>

        {/* Sidebar Footer Cards */}
        <div className="hidden md:flex flex-col gap-2.5 pt-4 border-t border-slate-800/80">
          {/* Branch Card */}
          <div className="flex items-center justify-between rounded-xl bg-slate-800/60 p-2.5 border border-slate-700/40 hover:bg-slate-800 transition-colors cursor-pointer">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-950/80 text-[#00bba7] border border-teal-800/40">
                <Store size={16} />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-white truncate max-w-[110px]">
                  {session.tenantName || "NR Collections"}
                </span>
                <span className="text-[11px] text-slate-400 truncate max-w-[110px]">
                  {session.branchName || "Main Branch"}
                </span>
              </div>
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </div>

          {/* User Profile Card */}
          <div className="flex items-center justify-between rounded-xl bg-slate-800/60 p-2.5 border border-slate-700/40 hover:bg-slate-800 transition-colors cursor-pointer">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-white font-medium text-xs">
                <User size={15} />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-white truncate max-w-[110px]">
                  {session.email ? session.email.split("@")[0] : "Kishore"}
                </span>
                <span className="text-[11px] text-slate-400 capitalize truncate max-w-[110px]">
                  {demoRole || "Cashier"}
                </span>
              </div>
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="order-1 flex min-w-0 flex-1 flex-col md:order-2">
        {session.mode === "demo" ? (
          <div
            role="note"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 print:hidden"
          >
            <span>
              <strong>Demo mode.</strong> Interactive POS mockup with simulated live workflows.
            </span>
            {demoRole ? <DemoRoleSwitcher role={demoRole} /> : null}
          </div>
        ) : null}

        {/* Top Header Bar */}
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 print:hidden shadow-2xs">
          <div className="flex flex-col">
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">Billing / POS</h1>
            <p className="text-xs text-slate-500">Scan products, add to cart and complete the sale</p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label="Notifications"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            >
              <Bell size={17} />
            </button>
            <button
              type="button"
              aria-label="Refresh & Sync"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            >
              <RotateCw size={16} />
            </button>
            <Link
              href="/billing"
              className="flex items-center gap-1.5 rounded-lg bg-[#00bba7] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#009688] shadow-xs transition-colors"
            >
              <Plus size={16} />
              <span>New Sale</span>
            </Link>

            {session.mode === "supabase" ? (
              <form action={signOutAction}>
                <Button type="submit" variant="ghost" size="md" aria-label="Sign out">
                  <LogOut aria-hidden size={17} /> <span className="hidden sm:inline">Sign out</span>
                </Button>
              </form>
            ) : null}
          </div>
        </header>

        <main className="flex-1 p-4 pb-24 md:p-5 md:pb-6 print:p-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

