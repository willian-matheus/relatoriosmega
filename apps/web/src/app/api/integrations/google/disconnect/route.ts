import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function POST() {
  try {
    const supabase = getSupabaseServerClient();
    await supabase
      .from("google_drive_integrations")
      .update({
        active: false,
        access_token: null,
        refresh_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", "default_user");

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erro ao desconectar Google Drive:", err);
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Falha ao desconectar Google Drive",
      },
      { status: 500 },
    );
  }
}
