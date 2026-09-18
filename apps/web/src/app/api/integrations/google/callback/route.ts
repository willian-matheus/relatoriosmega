import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getGoogleOAuthClient } from "@/lib/google";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const baseUrl = new URL("/", request.url);
  baseUrl.searchParams.set("view", "integrations");

  if (error || !code) {
    console.error("Erro no retorno do Google OAuth:", error);
    baseUrl.searchParams.set("google", "error");
    baseUrl.searchParams.set(
      "message",
      error || "Código de autorização não recebido",
    );
    return NextResponse.redirect(baseUrl);
  }

  try {
    const host = request.headers.get("host") || "localhost:3000";
    const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
    const protocol =
      request.headers.get("x-forwarded-proto") || (isLocal ? "http" : "https");

    let redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (isLocal) {
      redirectUri = `http://${host}/api/integrations/google/callback`;
    } else if (!redirectUri || redirectUri.includes("localhost")) {
      redirectUri = `${protocol}://${host}/api/integrations/google/callback`;
    }

    const oauthClient = getGoogleOAuthClient(redirectUri);
    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);

    // Obtém o e-mail da conta Google conectada
    const oauth2 = google.oauth2({ version: "v2", auth: oauthClient });
    let googleEmail: string | null = null;
    try {
      const userInfo = await oauth2.userinfo.get();
      googleEmail = userInfo.data.email || null;
    } catch (e) {
      console.warn("Não foi possível obter dados do usuário Google:", e);
    }

    // Testa a conexão com o Drive imediatamente
    let lastTestedAt: string | null = null;
    try {
      const drive = google.drive({ version: "v3", auth: oauthClient });
      await drive.files.list({ pageSize: 1 });
      lastTestedAt = new Date().toISOString();
    } catch (driveErr) {
      console.warn("Falha no teste inicial do Drive:", driveErr);
    }

    // Salva as credenciais no Supabase
    const supabase = getSupabaseServerClient();
    const { error: dbError } = await supabase
      .from("google_drive_integrations")
      .upsert(
        {
          user_id: "default_user",
          google_email: googleEmail,
          access_token: tokens.access_token || null,
          refresh_token: tokens.refresh_token || null,
          expires_at: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          scope: tokens.scope || null,
          active: true,
          last_tested_at: lastTestedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (dbError) {
      console.error(
        "Erro ao salvar integração do Google Drive no Supabase:",
        dbError,
      );
      baseUrl.searchParams.set("google", "error");
      baseUrl.searchParams.set(
        "message",
        "Falha ao persistir tokens no banco de dados",
      );
      return NextResponse.redirect(baseUrl);
    }

    baseUrl.searchParams.set("google", "connected");
    return NextResponse.redirect(baseUrl);
  } catch (err) {
    console.error("Exceção no processamento do callback do Google:", err);
    baseUrl.searchParams.set("google", "error");
    baseUrl.searchParams.set(
      "message",
      err instanceof Error ? err.message : "Erro desconhecido na autorização",
    );
    return NextResponse.redirect(baseUrl);
  }
}
