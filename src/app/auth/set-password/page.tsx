import { AuthForm } from "@/components/auth/auth-form";
import { setPasswordAction } from "@/server/auth/actions";

export const metadata = { title: "Choose a password" };

// Reached from an invitation or password-recovery email after /auth/confirm has created a session.
export default function SetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Choose a password</h1>
        <p className="text-muted">At least 10 characters. You will use it to sign in.</p>
      </div>
      <AuthForm
        action={setPasswordAction}
        submitLabel="Save password"
        fields={[
          { name: "password", label: "New password", type: "password", autoComplete: "new-password" },
          { name: "confirm", label: "Type it again", type: "password", autoComplete: "new-password" },
        ]}
      />
    </main>
  );
}
