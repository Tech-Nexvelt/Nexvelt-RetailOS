import { z } from "zod";
import { safeNextPath } from "@/lib/env";
import { canInBranch, canInTenant, type AuthContext } from "./context";

/**
 * Authentication behaviour as plain functions with injected dependencies, so it can be tested
 * without a running Supabase and so the Next.js actions stay thin.
 *
 * Principles
 *  - Messages never reveal whether an account exists.
 *  - Roles are NEVER taken from anything a person supplies at sign-up or from invitation metadata.
 *    Access exists only if a membership row exists, and membership rows are created by a database
 *    function that re-checks the inviter's authority.
 */
export interface AuthError {
  message: string;
  status?: number;
}
export interface AuthApi {
  signInWithPassword(c: { email: string; password: string }): Promise<{ error: AuthError | null }>;
  signOut(): Promise<{ error: AuthError | null }>;
  resetPasswordForEmail(
    email: string,
    o: { redirectTo: string },
  ): Promise<{ error: AuthError | null }>;
  updateUser(a: { password: string }): Promise<{ error: AuthError | null }>;
  getUser(): Promise<{ data: { user: { id: string } | null }; error: AuthError | null }>;
  verifyOtp(p: {
    type: "invite" | "recovery" | "email";
    token_hash: string;
  }): Promise<{ error: AuthError | null }>;
}

export type Outcome =
  { ok: true; message?: string; redirectTo?: string } | { ok: false; message: string };

const email = z.string().trim().toLowerCase().email().max(254);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72; // bcrypt limit used by Supabase Auth

export async function signIn(
  auth: AuthApi,
  raw: { email: unknown; password: unknown; next?: unknown },
): Promise<Outcome> {
  const e = email.safeParse(raw.email);
  const p = z.string().min(1).max(200).safeParse(raw.password);
  if (!e.success || !p.success) return { ok: false, message: "Enter your email and password." };
  const { error } = await auth.signInWithPassword({ email: e.data, password: p.data });
  if (error) {
    if (error.status === 429)
      return { ok: false, message: "Too many attempts. Wait a few minutes and try again." };
    // Same message for a wrong password, an unknown email and an unconfirmed account.
    return { ok: false, message: "The email or password is not correct." };
  }
  return { ok: true, redirectTo: safeNextPath(typeof raw.next === "string" ? raw.next : null) };
}

export async function signOut(auth: AuthApi): Promise<Outcome> {
  await auth.signOut();
  return { ok: true, redirectTo: "/login" };
}

/** Always reports success, so the form cannot be used to discover which emails have accounts. */
export async function requestPasswordReset(
  auth: AuthApi,
  siteUrl: string,
  rawEmail: unknown,
): Promise<Outcome> {
  const e = email.safeParse(rawEmail);
  if (!e.success) return { ok: false, message: "Enter a valid email address." };
  await auth
    .resetPasswordForEmail(e.data, {
      redirectTo: `${siteUrl}/auth/confirm?next=/auth/set-password`,
    })
    .catch(() => undefined);
  return {
    ok: true,
    message: "If that email has an account, we have sent a link to reset the password.",
  };
}

export function validateNewPassword(password: unknown, confirm: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN)
    return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (/^(.)\1+$/.test(password)) return "Choose a password that is not one repeated character.";
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}

/** Used after following an invitation or recovery link (which establishes a short-lived session). */
export async function setPassword(
  auth: AuthApi,
  password: unknown,
  confirm: unknown,
): Promise<Outcome> {
  const problem = validateNewPassword(password, confirm);
  if (problem) return { ok: false, message: problem };
  const { data } = await auth.getUser();
  if (!data.user) return { ok: false, message: "This link has expired. Ask for a new one." };
  const { error } = await auth.updateUser({ password: password as string });
  if (error) return { ok: false, message: "We could not save the password. Try a different one." };
  return { ok: true, redirectTo: "/billing" };
}

/** Exchange the token from an invitation / recovery email link for a session. */
export async function confirmLink(
  auth: AuthApi,
  tokenHash: string | null,
  type: string | null,
  next: string | null,
): Promise<Outcome> {
  if (!tokenHash || (type !== "invite" && type !== "recovery" && type !== "email")) {
    return { ok: false, message: "This link is not valid." };
  }
  const { error } = await auth.verifyOtp({ type, token_hash: tokenHash });
  if (error)
    return { ok: false, message: "This link has expired or was already used. Ask for a new one." };
  return { ok: true, redirectTo: safeNextPath(next, "/auth/set-password") };
}

// ---------------------------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------------------------
export interface AdminAuth {
  inviteUserByEmail(
    email: string,
    o: { data: { full_name: string }; redirectTo: string },
  ): Promise<{ data: { user: { id: string } | null }; error: AuthError | null }>;
}
export interface RpcCaller {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ error: { message: string } | null }>;
}

const inviteSchema = z
  .object({
    tenantId: z.uuid(),
    email,
    fullName: z.string().trim().min(1).max(120),
    // Only these can ever be requested. The owner role is deliberately not invitable from this form.
    tenantRole: z.enum(["tenant_member"]),
    branchRoles: z
      .array(z.object({ branchId: z.uuid(), role: z.enum(["branch_manager", "cashier"]) }).strict())
      .max(20),
  })
  .strict();

/**
 * Invite a staff member.
 *  1. First gate: the caller must hold staff.manage (the database checks again).
 *  2. The invitation email is sent through Supabase Auth with the PRIVILEGED client, carrying only a
 *     display name. No role or tenant is placed in user metadata.
 *  3. The membership is created by the database function membership_grant, called as the INVITER
 *     (their own session), which re-checks their authority and looks the role up by key.
 */
export async function inviteStaff(deps: {
  ctx: AuthContext;
  admin: AdminAuth | null;
  userClient: RpcCaller;
  siteUrl: string;
  input: unknown;
}): Promise<Outcome> {
  const parsed = inviteSchema.safeParse(deps.input);
  if (!parsed.success)
    return { ok: false, message: "Check the name, email and branch roles and try again." };
  const v = parsed.data;
  // First gate (the database repeats it): the owner may invite anyone; a branch manager may add
  // cashiers to branches where they hold staff.manage, and nothing else.
  const tenantLevel = canInTenant(deps.ctx, v.tenantId, "staff.manage");
  const branchLevel =
    v.branchRoles.length > 0 &&
    v.branchRoles.every(
      (b) => b.role === "cashier" && canInBranch(deps.ctx, b.branchId, "staff.manage"),
    );
  if (!tenantLevel && !branchLevel) {
    return { ok: false, message: "Your role cannot invite this person. Ask the owner." };
  }
  if (!deps.admin)
    return { ok: false, message: "Inviting staff is not set up on this server yet." };

  const { data, error } = await deps.admin.inviteUserByEmail(v.email, {
    data: { full_name: v.fullName },
    redirectTo: `${deps.siteUrl}/auth/confirm?next=/auth/set-password`,
  });
  if (error || !data.user) {
    return {
      ok: false,
      message: "We could not send the invitation. The email may already have an account.",
    };
  }
  const granted = await deps.userClient.rpc("membership_grant", {
    p_tenant: v.tenantId,
    p_user: data.user.id,
    p_tenant_role: v.tenantRole,
    p_branch_roles: v.branchRoles,
  });
  if (granted.error) {
    return {
      ok: false,
      message:
        "The invitation was sent but access could not be set up. Ask the owner to try again.",
    };
  }
  return { ok: true, message: `Invitation sent to ${v.email}.` };
}
