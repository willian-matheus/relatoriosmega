import { NextRequest, NextResponse } from "next/server";
import { deliverStatements } from "@/lib/statement-delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/integrations/extratos/envio  (requer sessão)
 * Envia extratos capturados para a plataforma de destino (EXTRATOS_DESTINO_URL).
 * Corpo opcional: { limit, ids, dryRun }  — use dryRun: true para ver o que seria enviado.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const summary = await deliverStatements({
      limit: body?.limit ? Number(body.limit) : undefined,
      ids: Array.isArray(body?.ids) ? body.ids.map(String) : undefined,
      dryRun: Boolean(body?.dryRun),
    });
    return NextResponse.json(summary);
  } catch (err: any) {
    console.error("Erro no envio de extratos:", err);
    return NextResponse.json({ message: err?.message || "Falha no envio de extratos." }, { status: 500 });
  }
}
