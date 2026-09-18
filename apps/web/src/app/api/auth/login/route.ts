import { NextRequest, NextResponse } from "next/server";
import {
  checkPassword,
  createSessionToken,
  COOKIE_NAME,
  SESSION_DURATION_SECONDS,
} from "@/lib/auth";
import { authenticateGestta } from "@/lib/gestta";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "A senha de acesso é obrigatória." },
        { status: 400 },
      );
    }

    const trimmedPassword = password.trim();
    const trimmedEmail =
      email && typeof email === "string" ? email.trim() : "";

    let authenticatedUser: {
      email: string;
      name: string;
      role: string;
      source: "gestta" | "system";
    } | null = null;

    // 1. Tenta autenticar diretamente via API do Gestta caso seja o e-mail do Gestta ou credenciais corporativas
    if (
      trimmedEmail.includes("gestta") ||
      trimmedEmail.includes("megacontabilidade") ||
      trimmedPassword.startsWith("Mega@")
    ) {
      try {
        const { profile } = await authenticateGestta(
          trimmedEmail || "financeiro@megacontabilidade.com",
          trimmedPassword,
        );
        authenticatedUser = {
          email: profile.email,
          name: profile.name,
          role: profile.role || "gestta_admin",
          source: "gestta",
        };
      } catch (gesttaErr) {
        console.warn(
          "Tentativa de login no Gestta falhou:",
          gesttaErr instanceof Error ? gesttaErr.message : gesttaErr,
        );
      }
    }

    // 2. Se ainda não autenticado pelo Gestta, valida pela senha mestre do sistema
    if (!authenticatedUser) {
      const isSystemValid = checkPassword(trimmedPassword);
      if (isSystemValid) {
        const userEmail = trimmedEmail || "admin@megacrm.com";
        authenticatedUser = {
          email: userEmail,
          name: userEmail.split("@")[0] || "Administrador",
          role: "admin",
          source: "system",
        };
      }
    }

    // 3. Fallback: Se não casou com nenhum, tenta Gestta uma última vez com o e-mail informado
    if (!authenticatedUser && trimmedEmail.length > 0) {
      try {
        const { profile } = await authenticateGestta(
          trimmedEmail,
          trimmedPassword,
        );
        authenticatedUser = {
          email: profile.email,
          name: profile.name,
          role: profile.role || "gestta_user",
          source: "gestta",
        };
      } catch {
        // Falha normal de credenciais
      }
    }

    if (!authenticatedUser) {
      return NextResponse.json(
        {
          error:
            "Credenciais incorretas. Use seu login do Gestta ou a senha da plataforma.",
        },
        { status: 401 },
      );
    }

    const token = await createSessionToken({
      email: authenticatedUser.email,
      name: authenticatedUser.name,
      role: authenticatedUser.role,
    });

    const isProduction = process.env.NODE_ENV === "production";
    const response = NextResponse.json({
      success: true,
      user: {
        email: authenticatedUser.email,
        name: authenticatedUser.name,
        source: authenticatedUser.source,
      },
    });

    // Grava o cookie seguro HTTP-only
    response.cookies.set({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_SECONDS,
    });

    return response;
  } catch (err) {
    console.error("Erro no processamento de login:", err);
    return NextResponse.json(
      { error: "Ocorreu um erro interno ao processar o login." },
      { status: 500 },
    );
  }
}
