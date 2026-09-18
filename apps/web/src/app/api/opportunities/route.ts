import { NextRequest, NextResponse } from "next/server";
import { saveOpportunity } from "@/lib/crm-backend";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const opportunity = await saveOpportunity(body);
    return NextResponse.json(opportunity, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao salvar oportunidade." },
      { status: 400 },
    );
  }
}
