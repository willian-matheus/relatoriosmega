import { NextRequest, NextResponse } from "next/server";
import { syncGesttaStatements } from "@/lib/gestta-statements";

export const dynamic = "force-dynamic";
// A varredura percorre todas as tarefas da janela e baixa os arquivos novos
export const maxDuration = 300;

/**
 * POST /api/integrations/gestta/statements/sync  (requer sessão)
 * Corpo opcional: { startDate, endDate, maxTasks }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const summary = await syncGesttaStatements({
      startDate: typeof body?.startDate === "string" ? body.startDate : undefined,
      endDate: typeof body?.endDate === "string" ? body.endDate : undefined,
      maxTasks: body?.maxTasks ? Number(body.maxTasks) : undefined,
    });
    return NextResponse.json(summary);
  } catch (err: any) {
    console.error("Erro na captura de extratos do Gestta:", err);
    return NextResponse.json(
      { message: err?.message || "Falha ao capturar extratos do Gestta." },
      { status: 500 },
    );
  }
}
