import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { confirmLink, type AuthApi } from "@/server/auth/service";

/**
 * Landing point for the links in invitation and password-recovery emails.
 * The email template must point here with ?token_hash={{ .TokenHash }}&type=invite|recovery
 * (see docs/DEPLOYMENT_RUNBOOK.md §3). The token is exchanged for a session on the server.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const client = await createUserClient();
  if (!client) return NextResponse.redirect(new URL("/login?error=config", request.url));
  const r = await confirmLink(
    client.auth as unknown as AuthApi,
    url.searchParams.get("token_hash"),
    url.searchParams.get("type"),
    url.searchParams.get("next"),
  );
  if (!r.ok) return NextResponse.redirect(new URL("/login?error=link", request.url));
  return NextResponse.redirect(new URL(r.redirectTo ?? "/auth/set-password", request.url));
}
