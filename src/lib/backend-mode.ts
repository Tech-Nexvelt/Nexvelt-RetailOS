/**
 * The single place that decides which backend the app runs on. Nothing else may read BILLING_BACKEND.
 *
 *  - "supabase":       real database, real sign-in.
 *  - "demo":           in-memory fictitious data and NO sign-in. Allowed ONLY when NODE_ENV is
 *                      "development" or "test" (and never on a Vercel production deployment).
 *  - "demo_forbidden": demo was requested somewhere it is not allowed (production build/start, unknown
 *                      NODE_ENV, Vercel production). Everything refuses to run: fail closed.
 *  - "unconfigured":   anything else. Everything refuses to run.
 *
 * There is deliberately no override flag: a typo or a copied .env file must not be able to open an
 * unauthenticated back door on a real deployment. No environment VALUES are ever included in messages.
 * Pure and dependency-free, so it is safe to import from the edge proxy.
 */
export type BackendMode = "supabase" | "demo" | "demo_forbidden" | "unconfigured";

export interface BackendEnv {
  BILLING_BACKEND?: string | undefined;
  NODE_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
}

export const DEMO_FORBIDDEN_MESSAGE =
  "Demo mode is disabled outside development. Set BILLING_BACKEND=supabase and restart the server.";

// Literal property reads so the bundler can inline NODE_ENV in the edge runtime as well.
const fromProcess = (): BackendEnv => ({
  BILLING_BACKEND: process.env.BILLING_BACKEND,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
});

export function backendMode(env: BackendEnv = fromProcess()): BackendMode {
  if (env.BILLING_BACKEND === "supabase") return "supabase";
  if (env.BILLING_BACKEND === "demo") {
    const devLike = env.NODE_ENV === "development" || env.NODE_ENV === "test";
    return devLike && env.VERCEL_ENV !== "production" ? "demo" : "demo_forbidden";
  }
  return "unconfigured";
}
