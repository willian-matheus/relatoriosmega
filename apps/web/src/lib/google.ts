import { google } from "googleapis";
import { TablesUpdate } from "@mega/contracts";
import { getSupabaseServerClient } from "./supabase-server";

export function getGoogleOAuthClient(customRedirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    customRedirectUri ||
    process.env.GOOGLE_REDIRECT_URI ||
    "https://relatoriosmega.vercel.app/api/integrations/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET precisam estar configurados no .env",
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getAuthenticatedDriveClient(userId = "default_user") {
  const supabase = getSupabaseServerClient();
  const { data: integration, error } = await supabase
    .from("google_drive_integrations")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !integration || !integration.active) {
    return null;
  }

  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials({
    access_token: integration.access_token || undefined,
    refresh_token: integration.refresh_token || undefined,
    expiry_date: integration.expires_at
      ? new Date(integration.expires_at).getTime()
      : undefined,
  });

  // Atualização automática do token no Supabase ao renovar
  oauth2Client.on("tokens", async (tokens) => {
    const updates: TablesUpdate<"google_drive_integrations"> = {
      updated_at: new Date().toISOString(),
    };
    if (tokens.access_token) updates.access_token = tokens.access_token;
    if (tokens.refresh_token) updates.refresh_token = tokens.refresh_token;
    if (tokens.expiry_date) {
      updates.expires_at = new Date(tokens.expiry_date).toISOString();
    }
    await supabase
      .from("google_drive_integrations")
      .update(updates)
      .eq("user_id", userId);
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });
  return { drive, integration, oauth2Client };
}
