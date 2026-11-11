import { NextRequest, NextResponse } from "next/server";
import { revokeApiToken } from "@/lib/api-tokens";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await revokeApiToken(id);
    return NextResponse.json({ revoked: true });
  } catch (error: any) {
    return NextResponse.json(
      { message: error?.message || "Erro ao revogar token." },
      { status: 400 },
    );
  }
}
