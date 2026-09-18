import { NextRequest, NextResponse } from "next/server";
import { moveOpportunity } from "@/lib/crm-backend";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const opportunity = await moveOpportunity(id, body);
    return NextResponse.json(opportunity);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao mover oportunidade." },
      { status: 400 },
    );
  }
}
