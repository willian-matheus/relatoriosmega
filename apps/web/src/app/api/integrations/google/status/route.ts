import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const { data: integration, error } = await supabase
      .from("google_drive_integrations")
      .select("google_email, active, last_tested_at, folder_name")
      .eq("user_id", "default_user")
      .single();

    if (error || !integration || !integration.active) {
      return NextResponse.json({ connected: false });
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
