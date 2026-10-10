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
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          NexVelt <span className="text-primary-strong">RetailOS</span>
        </h1>
        <p className="text-muted">Sign in to start billing.</p>
      </div>
      {appMode() === "demo_forbidden" ? <Banner tone="error">{DEMO_FORBIDDEN_MESSAGE}</Banner> : error && NOTES[error] ? <Banner tone="warning">{NOTES[error]}</Banner> : null}
      <AuthForm
        action={signInAction}
        submitLabel="Sign in"
        hidden={{ next: safeNextPath(next, "") }}
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "username" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
      />
      <Link href="/forgot-password" className="text-sm text-primary-strong underline">
        Forgot your password?
      </Link>
    </main>
  );
}
