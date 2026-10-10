"use server";

import { redirect } from "next/navigation";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";
import { loadContext, type QueryClient } from "./context";
import {
  inviteStaff,
  requestPasswordReset,
  setPassword,
  signIn,
  signOut,
  type AdminAuth,
  type AuthApi,
  type RpcCaller,
} from "./service";

export interface FormState {
  ok?: boolean;
  message?: string;
}

const NOT_CONFIGURED: FormState = {
  ok: false,
  message: "Sign-in is not set up on this server yet.",
};

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const client = await createUserClient();
  if (!client) return NOT_CONFIGURED;
  const r = await signIn(client.auth as unknown as AuthApi, {
    email: form.get("email"),
    password: form.get("password"),
    next: form.get("next"),
  });
  if (r.ok && r.redirectTo) redirect(r.redirectTo);
  return { ok: r.ok, message: r.ok ? r.message : r.message };
}

export async function signOutAction(): Promise<void> {
  const client = await createUserClient();
  if (client) await signOut(client.auth as unknown as AuthApi);
  redirect("/login");
}

export async function requestResetAction(_prev: FormState, form: FormData): Promise<FormState> {
  const client = await createUserClient();
  const env = publicEnv();
  if (!client || !env) return NOT_CONFIGURED;
  const r = await requestPasswordReset(
    client.auth as unknown as AuthApi,
    env.siteUrl,
    form.get("email"),
  );
  return { ok: r.ok, message: r.ok ? r.message : r.message };
}

export async function setPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const client = await createUserClient();
  if (!client) return NOT_CONFIGURED;
  const r = await setPassword(
    client.auth as unknown as AuthApi,
    form.get("password"),
    form.get("confirm"),
  );
  if (r.ok && r.redirectTo) redirect(r.redirectTo);
  return { ok: r.ok, message: r.ok ? r.message : r.message };
}

export async function inviteStaffAction(input: unknown): Promise<FormState> {
  const client = await createUserClient();
  const env = publicEnv();
  if (!client || !env) return NOT_CONFIGURED;
  const ctx = await loadContext(client as unknown as QueryClient);
  if (!ctx) return { ok: false, message: "You are signed out. Sign in again." };
  const admin = createAdminClient();
  const r = await inviteStaff({
    ctx,
    admin: admin ? (admin.auth.admin as unknown as AdminAuth) : null,
    userClient: client as unknown as RpcCaller,
    siteUrl: env.siteUrl,
    input,
  });
  return { ok: r.ok, message: r.ok ? r.message : r.message };
}
