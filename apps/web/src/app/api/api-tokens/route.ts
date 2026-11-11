import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { createApiToken, listApiTokens } from "@/lib/api-tokens";

export const dynamic = "force-dynamic";

// Rotas protegidas pela sessão (proxy.ts): gerenciamento de tokens pela equipe.

export async function GET() {
  try {
    const tokens = await listApiTokens();
    return NextResponse.json({ tokens });
  } catch (error: any) {
    return NextResponse.json(
      { message: error?.message || "Erro ao listar tokens." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name : "";
    const rawDays = body?.expiresInDays;
    const expiresInDays =
      rawDays === null || rawDays === undefined || rawDays === "" ? null : Number(rawDays);

    const session = request.cookies.get(COOKIE_NAME)?.value;
    const user = session ? await verifySessionToken(session) : null;

    const { token, info } = await createApiToken({
      name,
      expiresInDays,
      createdBy: user?.email || null,
    });

    // O token completo é exibido uma única vez
    return NextResponse.json({ token, info }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { message: error?.message || "Erro ao criar token." },
      { status: 400 },
    );
  }
}
