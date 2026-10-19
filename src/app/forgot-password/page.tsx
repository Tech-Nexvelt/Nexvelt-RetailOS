import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { requestResetAction } from "@/server/auth/actions";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-xl p-7 flex flex-col gap-5 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00bba7] text-white shadow-md font-bold text-xl mb-1">
            K
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Forgot Password</h1>
          <p className="text-xs text-slate-500">Enter your email to receive a password reset link.</p>
        </div>

        <AuthForm
          action={requestResetAction}
          submitLabel="Send Reset Link"
          fields={[{ name: "email", label: "Email Address", type: "email", autoComplete: "username" }]}
        />

        <Link href="/login" className="text-xs text-[#00bba7] font-semibold hover:underline">
          Back to Sign In
        </Link>
      </div>
    </main>
  );
}

