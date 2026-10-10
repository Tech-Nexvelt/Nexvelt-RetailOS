import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { requestResetAction } from "@/server/auth/actions";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="text-muted">We will email you a link. It works once.</p>
      </div>
      <AuthForm
        action={requestResetAction}
        submitLabel="Send the link"
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "username" }]}
      />
      <Link href="/login" className="text-sm text-primary-strong underline">
        Back to sign in
      </Link>
    </main>
  );
}
