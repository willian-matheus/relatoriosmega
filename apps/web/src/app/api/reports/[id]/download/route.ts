import { NextRequest, NextResponse } from "next/server";
import { getReportDownloadUrl } from "@/lib/crm-backend";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const download = await getReportDownloadUrl(id);
    return NextResponse.json(download);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao gerar link de download." },
      { status: 400 },
    );
  }
}
