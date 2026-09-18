import { NextRequest, NextResponse } from "next/server";
import { getGesttaCustomers } from "@/lib/gestta";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const search = searchParams.get("search") || "";

  try {
    const data = await getGesttaCustomers({ page, limit, search });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Erro ao buscar clientes no Gestta:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Falha ao consultar clientes do Gestta.",
      },
      { status: 500 },
    );
  }
}
