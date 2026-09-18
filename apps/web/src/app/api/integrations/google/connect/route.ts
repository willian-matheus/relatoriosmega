import { NextRequest, NextResponse } from "next/server";
import { getGoogleOAuthClient } from "@/lib/google";

export async function GET(request: NextRequest) {
  try {
    const oauthClient = getGoogleOAuthClient();

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
