import { NextRequest, NextResponse } from "next/server";
import { authenticateGestta } from "@/lib/gestta";

export async function POST(request: NextRequest) {
  try {
    let email: string | undefined;
    let password: string | undefined;

    try {
      const body = await request.json();
      email = body.email;
      password = body.password;
    } catch {
      // Usa credenciais padrão se não enviado corpo
    }

    const { profile } = await authenticateGestta(email, password);

    return NextResponse.json({
      success: true,
      message: "Gestta conectado com sucesso!",
      profile: {
        name: profile.name,
        email: profile.email,
        company: profile.company.name,
        cnpj: profile.company.cnpj,
      },
    });
  } catch (err) {
    console.error("Erro ao conectar Gestta:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Falha na conexão com o Gestta.",
      },
      { status: 400 },
    );
  }
}
