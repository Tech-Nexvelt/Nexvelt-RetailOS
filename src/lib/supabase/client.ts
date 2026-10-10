import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, RETAILOS_SCHEMA } from "@/lib/env";

/**
 * Browser-side Supabase client. Uses the publishable key and the user's session in the browser.
 * Returns null when Supabase environment variables are not configured.
 */
export function createBrowserSupabaseClient(): SupabaseClient | null {
  const env = publicEnv();
  if (!env) return null;
  return createBrowserClient(env.supabaseUrl, env.supabaseKey, { db: { schema: RETAILOS_SCHEMA } }) as unknown as SupabaseClient;
}
