import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { Banner } from "@/components/ui/banner";
import { landingFor } from "@/domain/navigation";
import { DEMO_FORBIDDEN_MESSAGE } from "@/lib/backend-mode";
import { safeNextPath } from "@/lib/env";
import { appMode, getAppSession } from "@/server/app/session";
import { signInAction } from "@/server/auth/actions";

export const metadata = { title: "Sign in" };

const NOTES: Record<string, string> = {
  config: "This server has no database configured yet, so sign-in is switched off. The owner must finish the setup.",
  demo: DEMO_FORBIDDEN_MESSAGE,
  link: "That link has expired or was already used. Ask for a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (appMode() === "demo") redirect("/billing");
  if (appMode() === "supabase") {
    const s = await getAppSession();
    if (s) redirect(safeNextPath(next, landingFor(s.permissions)));
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-xl p-7 flex flex-col gap-5">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center gap-1.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00bba7] text-white shadow-md font-bold text-xl mb-1">
            K
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            NexVelt <span className="text-[#00bba7]">RetailOS</span>
          </h1>
          <p className="text-xs font-semibold text-slate-500">Welcome Back</p>
          <p className="text-[11px] text-slate-400">Sign in to continue to billing</p>
        </div>

        {appMode() === "demo_forbidden" ? (
          <Banner tone="error">{DEMO_FORBIDDEN_MESSAGE}</Banner>
        ) : error && NOTES[error] ? (
          <Banner tone="warning">{NOTES[error]}</Banner>
        ) : null}

        <AuthForm
          action={signInAction}
          submitLabel="Sign In"
          hidden={{ next: safeNextPath(next, "") }}
          fields={[
            { name: "email", label: "Email or Username", type: "email", autoComplete: "username" },
            { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
          ]}
        />

        <div className="flex items-center justify-between text-xs pt-1">
          <label className="flex items-center gap-1.5 text-slate-500">
            <input type="checkbox" className="rounded border-slate-300 text-[#00bba7]" />
            <span>Remember me</span>
          </label>
          <Link href="/forgot-password" className="text-[#00bba7] font-semibold hover:underline">
            Forgot password?
          </Link>
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-col gap-1.5 text-center">
          <p className="text-[11px] font-bold text-slate-400">Demo Accounts</p>
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-slate-600">
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200">Cashier</span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200">Manager</span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200">Owner</span>
          </div>
        </div>
      </div>
    </main>
  );
}

