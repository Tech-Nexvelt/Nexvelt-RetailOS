import Link from "next/link";
import { Building2, CreditCard, DollarSign, FileText, Lock, Percent, Printer, Store, Users } from "lucide-react";
import { BusinessForm, InviteForm, SalesAccessToggle, TaxModeForm } from "@/components/settings/settings-forms";
import { Banner } from "@/components/ui/banner";
import { requireSession } from "@/server/app/session";
import { loadSettings } from "@/server/app/settings";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("/settings");
  const can = (p: string) => s.permissions.has(p);
  const data = await loadSettings(s);
  const { tab = "profile" } = await searchParams;

  const settingsNav = [
    { id: "profile", label: "Store Profile", icon: <Store size={16} /> },
    { id: "branches", label: "Branches & Counters", icon: <Building2 size={16} /> },
    { id: "staff", label: "Staff & Permissions", icon: <Users size={16} /> },
    { id: "tax", label: "Tax Configuration", icon: <Percent size={16} /> },
    { id: "jewellery", label: "Jewellery Pricing", icon: <DollarSign size={16} /> },
    { id: "printers", label: "Barcode & Printers", icon: <Printer size={16} /> },
    { id: "invoice", label: "Invoice Format", icon: <FileText size={16} /> },
    { id: "payment", label: "Payment Methods", icon: <CreditCard size={16} /> },
    { id: "account", label: "Account & Subscription", icon: <Lock size={16} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="text-xs text-slate-500">{s.tenantName} · {s.branchName}</p>
      </div>

      {s.mode === "demo" ? (
        <Banner tone="warning" title="Demo mode">
          Settings can only be changed on a live connected database.
        </Banner>
      ) : null}

      {/* Main Settings Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Sub-Navigation Rail */}
        <aside className="lg:col-span-3 flex flex-col gap-1 bg-white border border-slate-200 rounded-2xl p-2.5 shadow-2xs">
          {settingsNav.map((item) => {
            const active = tab === item.id;
            return (
              <Link
                key={item.id}
                href={`/settings?tab=${item.id}`}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  active
                    ? "bg-teal-50 text-[#00bba7] border border-teal-100 shadow-2xs"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </aside>

        {/* Right Detail Main Panel */}
        <div className="lg:col-span-9 flex flex-col gap-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs">
          {tab === "profile" && can("settings.manage") ? (
            <div className="flex flex-col gap-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Store Profile</h2>
                <p className="text-xs text-slate-500">Manage shop details and receipt header information</p>
              </div>

              {/* Logo Upload Mockup */}
              <div className="flex items-center gap-4 py-2 border-b border-slate-100">
                <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center text-[#00bba7] font-extrabold text-xl shadow-2xs">
                  NR
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Store Logo</p>
                  <p className="text-[11px] text-slate-400">Recommended: 512 x 512 px PNG or WebP</p>
                </div>
              </div>

              <BusinessForm tradeName={data.tradeName} legalName={data.legalName} gstin={data.gstin} />
            </div>
          ) : tab === "tax" && can("settings.manage") ? (
            <div className="flex flex-col gap-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Tax Configuration</h2>
                <p className="text-xs text-slate-500">Configure GST tax rates and invoice rules</p>
              </div>
              <TaxModeForm enforced={data.taxEnforced} />
            </div>
          ) : tab === "staff" && can("staff.manage") ? (
            <div className="flex flex-col gap-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Staff &amp; Permissions at {s.branchName}</h2>
                <p className="text-xs text-slate-500">Manage cashier access and team permissions</p>
              </div>
              {data.staff.length === 0 ? (
                <p className="text-xs text-slate-500">No staff accounts yet. Invite a cashier below.</p>
              ) : (
                <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {data.staff.map((p) => (
                    <li key={p.userId} className="flex items-center justify-between p-3 text-xs">
                      <div>
                        <p className="font-bold text-slate-900">{p.name}</p>
                        <p className="text-slate-400">{p.role}{p.active ? "" : " · inactive"}</p>
                      </div>
                      {can("roles.manage") && p.role === "Cashier" && p.userId !== s.userId ? (
                        <SalesAccessToggle userId={p.userId} enabled={p.salesAccess} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <InviteForm />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Store Profile</h2>
                <p className="text-xs text-slate-500">Manage shop details and receipt header information</p>
              </div>

              {/* Logo Upload Box */}
              <div className="flex items-center gap-4 py-2 border-b border-slate-100">
                <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center text-[#00bba7] font-extrabold text-xl shadow-2xs">
                  NR
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Logo</p>
                  <p className="text-[11px] text-slate-400">Recommended: 512 x 512 px</p>
                </div>
              </div>

              {can("settings.manage") ? (
                <BusinessForm tradeName={data.tradeName} legalName={data.legalName} gstin={data.gstin} />
              ) : (
                <p className="text-xs text-slate-500">You need owner or manager permissions to modify settings.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

