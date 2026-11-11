import { NextRequest, NextResponse } from "next/server";
import { getOptionalSupabaseServerClient } from "@/lib/supabase-server";
import { buildDashboard, emptyDashboard, type DashboardOptions } from "@/lib/dashboard/aggregate";
import { loadDashboardInput } from "@/lib/dashboard/load";

export const dynamic = "force-dynamic";

// O retrato muda a cada ciclo de captura (10 min): guarda o resultado por 60 s por
// combinação de filtros. "refresh=1" ignora o cache (botão Atualizar).
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

/**
 * Painel de pendências (sessão exigida pelo proxy.ts).
 * Lê somente o Supabase (retrato gravado pela captura de extratos); não chama o Gestta.
 *
 * Parâmetros (opcionais):
 *   competencias  quantas competências na série (padrão 6, máx. 36)
 *   empresa       código da empresa
 *   responsavel   nome do responsável
 *   refresh       1 para ignorar o cache
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawCount = params.get("competencias");
  const options: DashboardOptions = {
    competencias: rawCount ? Number(rawCount) : undefined,
    empresa: params.get("empresa"),
    responsavel: params.get("responsavel"),
  };

  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) return NextResponse.json(emptyDashboard(options));

  const key = JSON.stringify([options.competencias ?? null, options.empresa ?? null, options.responsavel ?? null]);
  const hit = cache.get(key);
  if (hit && params.get("refresh") !== "1" && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, { headers: { "X-Cache": "HIT" } });
  }

  try {
    const input = await loadDashboardInput(supabase, { empresa: options.empresa });
    const data = buildDashboard(input, options);
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } });
  } catch (error: any) {
    return NextResponse.json(
      { message: error?.message || "Erro ao montar o painel." },
      { status: 500 },
    );
  }
}
