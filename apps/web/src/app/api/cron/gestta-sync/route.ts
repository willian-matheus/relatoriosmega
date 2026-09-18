import { NextResponse } from "next/server";
import {
  getGesttaCronStatus,
  startGesttaCron,
  triggerGesttaCronNow,
} from "@/lib/gestta-cron";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Garante que o serviço de 10 min está rodando
    const status = startGesttaCron();
    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Erro ao consultar status do agendamento Gestta",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { action } = await req.json().catch(() => ({ action: "sync_now" }));

    if (action === "sync_now") {
      const response = await triggerGesttaCronNow();
      return NextResponse.json({
        success: response.result.success,
        data: response,
      });
    }

    const currentStatus = getGesttaCronStatus();
    return NextResponse.json({
      success: true,
      status: currentStatus,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Falha ao acionar sincronização do Gestta",
      },
      { status: 500 },
    );
  }
}
