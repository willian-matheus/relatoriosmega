import { NextRequest, NextResponse } from "next/server";
import { removeOpportunity, saveOpportunity } from "@/lib/crm-backend";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const opportunity = await saveOpportunity(body, id);
    return NextResponse.json(opportunity);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao atualizar oportunidade." },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const res = await removeOpportunity(id);
    return NextResponse.json(res);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao excluir oportunidade." },
      { status: 400 },
    );
  }
}
