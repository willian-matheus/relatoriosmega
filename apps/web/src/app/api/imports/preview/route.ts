import { NextRequest, NextResponse } from "next/server";
import { previewImport } from "@/lib/crm-backend";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const preview = previewImport(body);
    return NextResponse.json(preview);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro na validação do relatório." },
      { status: 400 },
    );
  }
}
