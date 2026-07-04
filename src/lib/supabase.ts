import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

/**
 * User-scoped Supabase client. Pass a JWT from the Authorization header when
 * the request is authenticated.
 */
export function createClient(accessToken?: string): SupabaseClient {
  const env = getEnv();

  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        }
      : undefined
  );
}

/**
 * Admin client with service role key for backend operations.
 * USE WITH CAUTION. Bypasses RLS.
 */
export function createAdminClient(): SupabaseClient {
  const env = getEnv();

  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
