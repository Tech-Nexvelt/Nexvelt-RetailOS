import { navForPermissions, OWNER_HOME, BILLING_HOME, landingFor } from "@/domain/navigation";
import { signOutAction } from "@/server/auth/actions";
import type { AppSession } from "@/server/app/session";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavLinks } from "./nav-links";
import { DemoRoleSwitcher } from "./demo-role-switcher";
import { ROLE_PERMISSIONS, type Role } from "@/domain/navigation";

/** The signed-in frame: five-item navigation filtered by what THIS person may open. */
export function AppShell({ session, children }: { session: AppSession; children: React.ReactNode }) {
  const items = navForPermissions(session.permissions);
  const home = landingFor(session.permissions);
  const demoRole = (Object.keys(ROLE_PERMISSIONS) as Role[]).find(
    (r) => `demo-${r}` === session.userId,
  );
  return (
    <div className="flex min-h-dvh flex-col md:flex-row print:block">
      <aside className="order-2 border-t border-line bg-surface p-1 md:order-1 md:w-60 md:shrink-0 md:border-r md:border-t-0 md:p-3 print:hidden">
        <div className="mb-4 hidden px-3 pt-2 md:block">
          <Link href={home === OWNER_HOME || home === BILLING_HOME ? home : "/"} className="text-lg font-bold tracking-tight">
            NexVelt <span className="text-primary-strong">RetailOS</span>
          </Link>
          <p className="text-sm text-muted">{session.tenantName}</p>
          <p className="text-sm text-muted">{session.branchName}</p>
        </div>
        <NavLinks items={items} />
      </aside>
      <div className="order-1 flex min-w-0 flex-1 flex-col md:order-2">
        {session.mode === "demo" ? (
          <div role="note" className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning-bg px-4 py-2 text-sm text-warning print:hidden">
            <span>
              <strong>Demo mode.</strong> Fictitious items. Nothing is saved to a database and there is no real sign-in. Do not use for real sales.
            </span>
            {demoRole ? <DemoRoleSwitcher role={demoRole} /> : null}
          </div>
        ) : null}
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 print:hidden">
          <p className="min-w-0 truncate text-sm text-muted">
            <span className="md:hidden font-semibold text-ink">{session.tenantName} · </span>
            {session.branchName ? <span>{session.branchName}</span> : null}
            {session.email ? <span> · {session.email}</span> : null}
          </p>
          {session.mode === "supabase" ? (
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="md" aria-label="Sign out">
                <LogOut aria-hidden size={18} /> <span className="hidden sm:inline">Sign out</span>
              </Button>
            </form>
          ) : null}
        </header>
        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
