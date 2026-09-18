import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@mega/contracts";

let client: SupabaseClient<Database> | null = null;

export function getSupabaseServerClient(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no ambiente.",
    );
  }
  client = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
  return client;
}

export function getOptionalSupabaseServerClient(): SupabaseClient<Database> | null {
  try {
    return getSupabaseServerClient();
  } catch {
    return null;
  }
}
