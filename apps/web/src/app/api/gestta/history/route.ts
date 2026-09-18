import { NextResponse } from "next/server";
import { getGesttaHistoryGrouped } from "@/lib/gestta-sync";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const competence = searchParams.get("competence") || undefined;
    const status = searchParams.get("status") || undefined;

    const data = await getGesttaHistoryGrouped({
      search,
      competence,
      status,
    });

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error: any) {
    console.error("Erro na rota /api/gestta/history:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Erro ao consultar histórico de relatórios",
        companies: [],
        totalTasks: 0,
        totalCompanies: 0,
        competencesList: [],
      },
      { status: 500 },
    );
  }
}
