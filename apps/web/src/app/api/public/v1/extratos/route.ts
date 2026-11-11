import { NextRequest, NextResponse } from "next/server";
import {
  readApiTokenFromHeaders,
  STATEMENTS_READ_SCOPE,
  verifyApiToken,
} from "@/lib/api-tokens";
import { listStatements, onlyDigits, StatementFormat } from "@/lib/statements";

export const dynamic = "force-dynamic";

/**
 * API pública (autenticada por token) para plataformas externas listarem extratos.
 *
 * GET /api/public/v1/extratos?formato=ofx|pdf&competencia=AAAA-MM&cnpj=...&desde=ISO&pagina=1&limite=50
 * Cabeçalho: Authorization: Bearer mega_...   (ou X-API-Key: mega_...)
 */
export async function GET(request: NextRequest) {
  const auth = await verifyApiToken(
    readApiTokenFromHeaders(request.headers),
    STATEMENTS_READ_SCOPE,
  );
  if (!auth.ok) {
    return NextResponse.json(
      { erro: auth.error },
      {
        status: auth.status,
        headers: auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
      },
    );
  }

  const params = request.nextUrl.searchParams;
  const errors: string[] = [];

  const formatoParam = params.get("formato")?.toLowerCase();
  if (formatoParam && formatoParam !== "ofx" && formatoParam !== "pdf") {
    errors.push("'formato' deve ser 'ofx' ou 'pdf'.");
  }

  const competencia = params.get("competencia") || undefined;
  if (competencia && !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) {
    errors.push("'competencia' deve estar no formato AAAA-MM.");
  }

  const cnpj = params.get("cnpj") || undefined;
  if (cnpj && ![11, 14].includes(onlyDigits(cnpj).length)) {
    errors.push("'cnpj' deve ter 14 dígitos (ou 11 para CPF).");
  }

  const desdeParam = params.get("desde");
  let desde: string | undefined;
  if (desdeParam) {
    const date = new Date(desdeParam);
    if (Number.isNaN(date.getTime())) errors.push("'desde' deve ser uma data ISO 8601.");
    else desde = date.toISOString();
  }

  const pagina = Number(params.get("pagina") || 1);
  const limite = Number(params.get("limite") || 50);
  if (!Number.isInteger(pagina) || pagina < 1) errors.push("'pagina' deve ser um inteiro >= 1.");
  if (!Number.isInteger(limite) || limite < 1 || limite > 200) {
    errors.push("'limite' deve ser um inteiro entre 1 e 200.");
  }

  if (errors.length) {
    return NextResponse.json({ erro: "Parâmetros inválidos.", detalhes: errors }, { status: 400 });
  }

  try {
    const { items, total } = await listStatements({
      format: formatoParam as StatementFormat | undefined,
      competence: competencia,
      cnpj,
      since: desde,
      page: pagina,
      limit: limite,
    });

    const origin = request.nextUrl.origin;
    return NextResponse.json({
      dados: items.map((s) => ({
        id: s.id,
        formato: s.format,
        nomeArquivo: s.fileName,
        contentType: s.contentType,
        tamanho: s.fileSize,
        sha256: s.sha256,
        competencia: s.competence,
        tipoDocumento: s.documentType,
        empresa: { nome: s.companyName, cnpj: s.companyCnpj, codigo: s.companyCode },
        tarefa: { id: s.gesttaTaskId, nome: s.taskName },
        enviadoEm: s.uploadedAt,
        sincronizadoEm: s.syncedAt,
        // OFX gerado a partir do PDF quando o cliente não enviou OFX
        convertido: Boolean(s.convertedFromId),
        convertidoDe: s.convertedFromId,
        observacao: s.conversionNote,
        downloadUrl: `${origin}/api/public/v1/extratos/${s.id}/download`,
      })),
      paginacao: {
        pagina,
        limite,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / limite)),
      },
    });
  } catch (error: any) {
    console.error("Erro na API pública de extratos:", error);
    return NextResponse.json({ erro: "Não foi possível listar os extratos." }, { status: 500 });
  }
}
