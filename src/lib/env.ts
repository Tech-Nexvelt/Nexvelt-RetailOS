import { z } from "zod";

/**
 * Environment access. Only values that are SAFE for the browser are read here. The Supabase secret
 * key is read in exactly one server-only module (src/lib/supabase/admin.ts) and is never exported.
 */
/**
 * RetailOS lives in its own Postgres schema inside a Supabase project it SHARES with Tirumala Furniture.
 * Every Supabase client in this app is created with this schema so a query can never silently fall
 * through to Tirumala's `public` tables. The schema must also be listed under "Exposed schemas" in the
 * project's Data API settings (a manual dashboard step, see docs/RETAILOS_PRODUCTION_PREFLIGHT.md).
 */
export const RETAILOS_SCHEMA = "retailos";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  // Supabase "publishable" key (or the legacy anon key). Designed to be public; safe only because
  // every table is protected by Row Level Security.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  // Used to build links in emails. Taken from configuration, never from request headers.
  NEXT_PUBLIC_SITE_URL: z.url(),
});

export interface PublicEnv {
  supabaseUrl: string;
  supabaseKey: string;
  siteUrl: string;
}

/** Returns the public configuration, or null when Supabase is not configured. */
export function publicEnv(
  source: Record<string, string | undefined> = process.env,
): PublicEnv | null {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    // Accepts the newer "publishable" name or the legacy "anon" name; the publishable one wins if both are set.
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL,
  });
  if (!parsed.success) return null;
  return {
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    siteUrl: parsed.data.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, ""),
  };
}

/** The server-only privileged key: SUPABASE_SECRET_KEY, or the legacy name SUPABASE_SERVICE_ROLE_KEY. Never NEXT_PUBLIC_. */
export function serverSecretKey(source: Record<string, string | undefined> = process.env): string | null {
  return source.SUPABASE_SECRET_KEY || source.SUPABASE_SERVICE_ROLE_KEY || null;
}

const SECRET_NAME = /(service[_-]?role|secret|private[_-]?key|password|jwt[_-]?secret)/i;

/**
 * Names of environment variables that would be shipped to the browser (NEXT_PUBLIC_*) yet look like
 * secrets. Must always be empty. Checked in tests and available to CI.
 */
export function exposedSecretNames(
  source: Record<string, string | undefined> = process.env,
): string[] {
  return Object.keys(source).filter((k) => k.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(k));
}

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/billing"): string {
  if (!next) return fallback;
  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    /[\u0000-\u001f]/.test(next)
  ) {
    return fallback;
  }
  return next;
}
