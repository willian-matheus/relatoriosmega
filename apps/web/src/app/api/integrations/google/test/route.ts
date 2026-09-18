import { NextResponse } from "next/server";
import { getAuthenticatedDriveClient } from "@/lib/google";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function POST() {
  try {
    const client = await getAuthenticatedDriveClient();
    if (!client) {
      return NextResponse.json(
        { success: false, error: "Google Drive não está conectado." },
        { status: 400 },
      );
    }

    const { drive } = client;

    // Busca arquivos recentes no Drive (planilhas, CSVs, relatórios)
    const response = await drive.files.list({
      pageSize: 15,
      fields: "files(id, name, mimeType, size, modifiedTime, webViewLink)",
      q: "trashed = false",
      orderBy: "modifiedTime desc",
    });

    const files = response.data.files || [];
    const now = new Date().toISOString();

    // Atualiza a data do último teste no banco
    const supabase = getSupabaseServerClient();
    await supabase
      .from("google_drive_integrations")
      .update({ last_tested_at: now, updated_at: now })
      .eq("user_id", "default_user");

    return NextResponse.json({
      success: true,
      lastTestedAt: now,
      filesCount: files.length,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink,
      })),
    });
  } catch (err) {
    console.error("Erro ao testar conexão com o Google Drive:", err);
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Falha na comunicação com o Google Drive",
      },
      { status: 500 },
    );
  }
}
