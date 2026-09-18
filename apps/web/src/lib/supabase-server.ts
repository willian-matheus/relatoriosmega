import { createClient } from "@supabase/supabase-js";
import { Database } from "@mega/contracts";

export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}
