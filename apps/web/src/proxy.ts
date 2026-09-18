import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rotas públicas que não requerem autenticação
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/integrations/google/callback") ||
    pathname.startsWith("/api/google/callback") ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon.ico";

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await verifySessionToken(token) : null;
  const isAuthenticated = Boolean(user);

  // Se o usuário já estiver logado e tentar acessar a tela de login, redireciona para o Workspace
  if (pathname.startsWith("/login") && isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Se for rota pública, permite a navegação
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Se não estiver autenticado:
  if (!isAuthenticated) {
    // Para rotas de API protegidas, retorna 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Sessão expirada ou não autorizada. Faça login novamente." },
        { status: 401 },
      );
    }

    // Para páginas normais, redireciona para a tela de login
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Aplica em todas as rotas exceto arquivos estáticos:
     * - _next/static (arquivos estáticos compilados)
     * - _next/image (otimizador de imagens)
     * - imagens/ícones com extensões comuns
     */
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
