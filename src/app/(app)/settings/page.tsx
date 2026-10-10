import { BusinessForm, InviteForm, SalesAccessToggle, TaxModeForm } from "@/components/settings/settings-forms";
import { Banner } from "@/components/ui/banner";
import { requireSession } from "@/server/app/session";
import { loadSettings } from "@/server/app/settings";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await requireSession("/settings");
  const can = (p: string) => s.permissions.has(p);
  const data = await loadSettings(s);
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted">{s.tenantName} · {s.branchName}</p>
      </div>
      {s.mode === "demo" ? <Banner tone="warning" title="Demo mode">Settings can only be changed on the real database.</Banner> : null}

      {can("settings.manage") ? (
        <>
          <section aria-labelledby="biz" className="flex flex-col gap-3">
            <h2 id="biz" className="text-lg font-semibold">Business details</h2>
            <BusinessForm tradeName={data.tradeName} legalName={data.legalName} gstin={data.gstin} />
          </section>
          <section aria-labelledby="tax" className="flex flex-col gap-3">
            <h2 id="tax" className="text-lg font-semibold">Tax</h2>
            <TaxModeForm enforced={data.taxEnforced} />
          </section>
        </>
      ) : null}

      {can("staff.manage") ? (
        <section aria-labelledby="staff" className="flex flex-col gap-3">
          <h2 id="staff" className="text-lg font-semibold">Staff at {s.branchName}</h2>
          {data.staff.length === 0 ? (
            <p className="text-muted">No staff yet. Invite a cashier below.</p>
          ) : (
            <ul className="max-w-xl rounded-ctl border border-line bg-surface">
              {data.staff.map((p) => (
                <li key={p.userId} className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3 last:border-b-0">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-muted">{p.role}{p.active ? "" : " · switched off"}</p>
                  </div>
                  {can("roles.manage") && p.role === "Cashier" && p.userId !== s.userId ? (
                    <SalesAccessToggle userId={p.userId} enabled={p.salesAccess} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <InviteForm />
        </section>
      ) : null}

      {!can("settings.manage") && !can("staff.manage") ? <p className="text-muted">There is nothing here for your role.</p> : null}
    </div>
  );
}
