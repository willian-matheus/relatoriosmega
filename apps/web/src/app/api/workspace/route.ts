import { NextResponse } from "next/server";
import { getWorkspaceSnapshot } from "@/lib/crm-backend";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getWorkspaceSnapshot();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Erro ao carregar workspace:", error);
    return NextResponse.json(
      { error: error?.message || "Erro ao carregar workspace." },
      { status: 500 },
    );
  }
}
