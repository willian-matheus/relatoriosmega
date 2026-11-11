import { buildOfx, parsePdfStatement, type PdfStatementResult } from "./pdf-to-ofx";
import { ofcToOfx } from "./ofc";
import {
  getCapturedStatements,
  saveStatementFromGesttaDocument,
  type StatementFile,
} from "./statements";

/**
 * Conversões para OFX (o formato que o destino e os sistemas contábeis leem):
 *  - PDF de conta corrente -> OFX, só quando os lançamentos fecham com os saldos do PDF;
 *  - OFC -> OFX (dados estruturados, convertidos campo a campo).
 * O OFX gerado é guardado como um novo extrato, ligado ao arquivo de origem.
 * Usado pela captura do Gestta e pelo recebimento de extratos pela API.
 */

export const CONVERTED_SUFFIX = "-convertido-ofx";

export type ConversionResult =
  | { ok: true; already: false; saved: StatementFile; ofx: Buffer }
  /** já havia OFX convertido deste arquivo (id e se já tem cópia no Drive) */
  | { ok: true; already: true; convertedId: string; driveFileId: string | null }
  | { ok: false; reason: string };

const originLabel = (s: StatementFile) =>
  s.source === "api" ? "recebido de outra plataforma" : "enviado pelo cliente";

export function buildConversionNote(
  pdfFileName: string,
  result: PdfStatementResult,
  origin = "enviado pelo cliente",
): string {
  const brl = (n?: number) =>
    n === undefined ? "-" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmt = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "?");
  const first = result.period?.start || result.transactions[0]?.date;
  const last = result.period?.end || result.transactions[result.transactions.length - 1]?.date;
  return (
    `Arquivo convertido automaticamente do PDF "${pdfFileName}" ${origin} (não foi enviado OFX). ` +
    `${result.transactions.length} lançamentos de ${fmt(first)} a ${fmt(last)}, conferidos com os saldos do extrato ` +
    `(saldo inicial ${brl(result.openingBalance)}, saldo final ${brl(result.closingBalance)}).`
  );
}

function buildOfcNote(fileName: string, count: number, start?: string, end?: string, closing?: number, origin = "enviado pelo cliente"): string {
  const fmt = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "?");
  const saldo =
    closing === undefined ? "" : `, saldo final ${closing.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
  return (
    `Arquivo convertido automaticamente do OFC "${fileName}" ${origin}. ` +
    `${count} lançamentos de ${fmt(start)} a ${fmt(end)}${saldo}.`
  );
}

/** Dados de origem repassados ao OFX convertido (mesma empresa, competência, tipo e remetente). */
function inherit(source: StatementFile) {
  return {
    task: {
      id: source.gesttaTaskId,
      name: source.taskName || "",
      companyName: source.companyName,
      companyCode: source.companyCode || undefined,
      companyCnpj: source.companyCnpj || undefined,
      competence: source.competence || undefined,
    },
    documentType: source.documentType || undefined,
    uploadedAt: source.uploadedAt || undefined,
    received: source.source === "api" ? { tokenId: source.receivedByTokenId } : undefined,
  };
}

async function alreadyConverted(source: StatementFile): Promise<{ id: string; driveFileId: string | null } | null> {
  const convertedDocId = `${source.gesttaDocumentId}${CONVERTED_SUFFIX}`;
  return (await getCapturedStatements([convertedDocId])).get(convertedDocId) ?? null;
}

/** PDF de conta corrente -> OFX (com conferência de saldos). */
export async function convertPdfStatement(pdf: StatementFile, buffer: Buffer): Promise<ConversionResult> {
  if (pdf.format !== "pdf") return { ok: false, reason: "o arquivo não é PDF" };
  const existing = await alreadyConverted(pdf);
  if (existing) return { ok: true, already: true, convertedId: existing.id, driveFileId: existing.driveFileId };

  const result = await parsePdfStatement(buffer, { fileName: pdf.fileName });
  if (!result.ok) return { ok: false, reason: result.reason || "falha na leitura do PDF" };

  const ofx = buildOfx(result, { fitIdPrefix: pdf.gesttaDocumentId.replace(/[^A-Za-z0-9]/g, "").slice(-8) });
  const base = pdf.fileName.replace(/\.pdf$/i, "");
  const saved = await saveStatementFromGesttaDocument({
    documentId: `${pdf.gesttaDocumentId}${CONVERTED_SUFFIX}`,
    fileName: `${base} (arquivo convertido do PDF).ofx`,
    buffer: ofx,
    ...inherit(pdf),
    syncedAt: new Date().toISOString(),
    conversion: { fromId: pdf.id, note: buildConversionNote(pdf.fileName, result, originLabel(pdf)) },
  });
  if (!saved) return { ok: false, reason: "OFX gerado inválido" };
  return { ok: true, already: false, saved, ofx };
}

/** OFC -> OFX. */
export async function convertOfcStatement(ofc: StatementFile, buffer: Buffer): Promise<ConversionResult> {
  if (ofc.format !== "ofc") return { ok: false, reason: "o arquivo não é OFC" };
  const existing = await alreadyConverted(ofc);
  if (existing) return { ok: true, already: true, convertedId: existing.id, driveFileId: existing.driveFileId };

  let converted: ReturnType<typeof ofcToOfx>;
  try {
    converted = ofcToOfx(buffer, { fitIdPrefix: ofc.gesttaDocumentId.replace(/[^A-Za-z0-9]/g, "").slice(-8) });
  } catch (err: any) {
    return { ok: false, reason: `OFC ilegível: ${err?.message || err}` };
  }
  const st = converted.statement;
  const dates = st.transactions.map((t) => t.date).sort();
  const base = ofc.fileName.replace(/\.ofc$/i, "");
  const saved = await saveStatementFromGesttaDocument({
    documentId: `${ofc.gesttaDocumentId}${CONVERTED_SUFFIX}`,
    fileName: `${base} (arquivo convertido do OFC).ofx`,
    buffer: converted.ofx,
    ...inherit(ofc),
    syncedAt: new Date().toISOString(),
    conversion: {
      fromId: ofc.id,
      note: buildOfcNote(
        ofc.fileName,
        st.transactions.length,
        st.period?.start || dates[0],
        st.period?.end || dates[dates.length - 1],
        st.closingBalance,
        originLabel(ofc),
      ),
    },
  });
  if (!saved) return { ok: false, reason: "OFX gerado inválido" };
  return { ok: true, already: false, saved, ofx: converted.ofx };
}
