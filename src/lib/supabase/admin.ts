import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, RETAILOS_SCHEMA, serverSecretKey } from "@/lib/env";

/**
 * PRIVILEGED client (secret key; bypasses Row Level Security).
 *
 * Rules:
 *  - Server-only: the `server-only` import makes any client-side import a build error.
 *  - The key comes from SUPABASE_SECRET_KEY (or the legacy name SUPABASE_SERVICE_ROLE_KEY), which must never carry a NEXT_PUBLIC_ prefix.
 *  - Use ONLY for Auth admin calls (inviting users). Never to read or write business tables:
 *    business data must go through the user's own client so RLS and permissions apply.
 */
export function createAdminClient(): SupabaseClient | null {
  const env = publicEnv();
  const secret = serverSecretKey();
  if (!env || !secret) return null;
  return createClient(env.supabaseUrl, secret, {
    // The default schema is retailos, so even this all-powerful key cannot touch Tirumala's `public` tables by accident.
    db: { schema: RETAILOS_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;
}
