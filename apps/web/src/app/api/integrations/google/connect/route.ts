import { NextRequest, NextResponse } from "next/server";
import { getGoogleOAuthClient } from "@/lib/google";

export async function GET(request: NextRequest) {
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

    const url = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
    });

    return NextResponse.redirect(url);
  } catch (err) {
    console.error("Erro ao iniciar fluxo Google OAuth:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Falha ao gerar link de conexão Google",
      },
      { status: 500 },
    );
  }
}
