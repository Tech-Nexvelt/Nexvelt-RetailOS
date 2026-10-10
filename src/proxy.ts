import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { backendMode, DEMO_FORBIDDEN_MESSAGE } from "@/lib/backend-mode";
import { publicEnv } from "@/lib/env";

/**
 * Runs before every matched request. It does two things only:
 *  1. refreshes the Supabase session cookie so it does not expire mid-shift, and
 *  2. as an early optimistic check, sends signed-out visitors to /login.
 *
 * This is NOT the authorisation boundary. Every page and server action re-verifies the user
 * (supabase.auth.getUser) and every database call is checked again by Row Level Security.
 */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth/confirm", "/auth/set-password"];

export async function proxy(request: NextRequest) {
  // The explicit development demo has no sign-in. It exists only in development/test processes
  // (src/lib/backend-mode.ts). If demo is requested anywhere else, EVERY request is refused.
  const mode = backendMode();
  if (mode === "demo_forbidden") {
    return new NextResponse(DEMO_FORBIDDEN_MESSAGE, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (mode === "demo") return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const env = publicEnv();
  if (!env) {
    // Not configured: fail closed. The login page explains what is missing.
    return isPublic
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/login?error=config", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims validates the token signature and refreshes it when needed.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublic) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Everything except static assets and image optimisation.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
