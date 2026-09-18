import { NextRequest, NextResponse } from "next/server";
import { commitImport } from "@/lib/crm-backend";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const report = await commitImport(token);
    return NextResponse.json(report, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao importar relatório." },
      { status: 400 },
    );
  }
}
