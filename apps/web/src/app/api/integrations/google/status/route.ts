import { NextResponse } from "next/server";
import { getAuthenticatedDriveClient } from "@/lib/google";

export async function GET() {
  try {
    const client = await getAuthenticatedDriveClient("default_user");
    if (!client) {
      return NextResponse.json({ connected: false });
    }

    const { integration, oauth2Client } = client;

    // O registro pode estar "ativo" com o acesso já expirado/revogado no Google
    // (ex.: app OAuth em modo Teste expira o token em 7 dias). Valida antes de
    // informar que está conectado, para a interface oferecer a reconexão.
    try {
      await oauth2Client.getAccessToken();
    } catch (tokenErr: any) {
      console.warn(
        "Acesso ao Google Drive expirado ou revogado:",
        tokenErr?.response?.data?.error || tokenErr?.message || tokenErr,
      );
      return NextResponse.json({
        connected: false,
        expired: true,
        email: integration.google_email,
      });
    }

    return NextResponse.json({
      connected: true,
      email: integration.google_email,
      lastTestedAt: integration.last_tested_at,
      folderName: integration.folder_name,
    });
  } catch (err) {
    console.error("Erro ao verificar status do Google Drive:", err);
    return NextResponse.json({ connected: false });
  }
}
