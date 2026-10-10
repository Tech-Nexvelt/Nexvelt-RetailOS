import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv, RETAILOS_SCHEMA } from "@/lib/env";

/**
 * Supabase client for the signed-in user, running on the server. It uses the publishable key and the
 * user's own session cookie, so every query is subject to Row Level Security as that user.
 * Returns null when Supabase is not configured (callers must fail closed).
 */
export async function createUserClient(): Promise<SupabaseClient | null> {
  const env = publicEnv();
  if (!env) return null;
  const store = await cookies();
  // The schema option changes only a type parameter; callers keep using the plain SupabaseClient type.
  return createServerClient(env.supabaseUrl, env.supabaseKey, {
    db: { schema: RETAILOS_SCHEMA },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes the
          // session on each request, so this is safe to ignore.
        }
      },
    },
  }) as unknown as SupabaseClient;
}
