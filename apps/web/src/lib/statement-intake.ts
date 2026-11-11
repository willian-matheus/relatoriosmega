import { createHash } from "node:crypto";
import { parseOfxTransactions, parsePdfStatement } from "./pdf-to-ofx";
import { competenceFromTransactions, parseOfc } from "./ofc";
import {
  detectStatementFormat,
  getCapturedStatements,
  getStatementContent,
  onlyDigits,
  saveStatementFromGesttaDocument,
  type StatementFile,
  type StatementFormat,
} from "./statements";
import { convertOfcStatement, convertPdfStatement, type ConversionResult } from "./statement-conversions";

/**
 * Recebimento de extratos enviados por outras plataformas (POST /api/public/v1/extratos,
 * token com permissão "extratos:write").
 *
 * Aceita OFX, PDF e OFC (extensão em maiúsculas ou minúsculas) e confere o CONTEÚDO
 * do arquivo: um PDF renomeado para .ofx é recusado. O extrato recebido segue o mesmo
 * caminho dos capturados do Gestta: armazenamento, cópia no Drive, Painel, API de
 * consulta e envio ao CRM-MEGA (com a deduplicação de lá). OFC é guardado como chegou
 * e convertido para OFX; PDF de conta corrente tenta a conversão com conferência de saldos.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // limite do bucket "statements"
export const ACCEPTED_EXTENSION = /\.(ofx|pdf|ofc)$/i;

/** Tipos de extrato aceitos e o nome usado no relatoriosmega (o mesmo padrão do Gestta) */
export const STATEMENT_TYPES = {
  conta_corrente: "Extratos de Conta Corrente (recebido pela API)",
  aplicacao: "Extratos de Aplicações Financeiras (recebido pela API)",
  emprestimo: "Extratos de Empréstimos/Financiamentos (recebido pela API)",
  cotas: "Extratos de Cotas de Capital (recebido pela API)",
} as const;
export type StatementTypeKey = keyof typeof STATEMENT_TYPES;

export interface IntakeInput {
  fileName: string;
  buffer: Buffer;
  tokenId: string | null;
  cnpj?: string | null;
  empresaCodigo?: string | null;
  empresaNome?: string | null;
  competencia?: string | null;
  tipo?: string | null;
  /** dados livres informados pelo remetente (banco, agência, conta, observação) */
  metadata?: Record<string, string>;
}

export interface CustomerRef {
  code: string | null;
  name: string;
  cnpj: string | null;
}

export interface IntakeDeps {
  /** Busca a empresa no cadastro do Gestta por CNPJ/CPF e/ou código */
  findCustomer: (q: { cnpj: string | null; code: string | null }) => Promise<{ byCnpj: CustomerRef | null; byCode: CustomerRef | null }>;
  findReceived: (documentId: string) => Promise<StatementFile | null>;
  save: typeof saveStatementFromGesttaDocument;
  convertOfc: (s: StatementFile, b: Buffer) => Promise<ConversionResult>;
  convertPdf: (s: StatementFile, b: Buffer) => Promise<ConversionResult>;
  copyToDrive: (s: StatementFile, b: Buffer) => Promise<unknown>;
  now?: () => Date;
}

export type IntakeResponse =
  | { status: 201 | 200; body: Record<string, unknown> }
  | { status: 400 | 413 | 415 | 422; body: { erro: string; detalhes?: string[] } };

const fail = (status: 400 | 413 | 415 | 422, erro: string, detalhes?: string[]): IntakeResponse => ({
  status,
  body: detalhes?.length ? { erro, detalhes } : { erro },
});

/** Formato pelo conteúdo, conferido com a extensão. OFX e OFC podem vir trocados (são estruturados). */
export function resolveFormat(fileName: string, buffer: Buffer): { format: StatementFormat } | { error: string } {
  const ext = (fileName.match(ACCEPTED_EXTENSION)?.[1] || "").toLowerCase();
  if (!ext) return { error: "extensão não aceita: envie .ofx, .pdf ou .ofc" };
  const detected = detectStatementFormat({ fileName: "extrato", buffer, context: "extrato bancário" });
  if (!detected) return { error: `o conteúdo não é um ${ext.toUpperCase()} válido` };
  if (ext === "pdf" && detected !== "pdf") return { error: "o arquivo tem extensão .pdf, mas o conteúdo não é PDF" };
  if (ext !== "pdf" && detected === "pdf") return { error: `o arquivo tem extensão .${ext}, mas o conteúdo é PDF` };
  return { format: detected };
}

/** Competência informada (validada) ou deduzida dos lançamentos do arquivo. */
export async function resolveCompetence(
  informed: string | null | undefined,
  format: StatementFormat,
  buffer: Buffer,
  fileName: string,
): Promise<{ competence: string } | { error: string }> {
  const raw = (informed || "").trim();
  if (raw) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return { error: "'competencia' deve estar no formato AAAA-MM" };
    return { competence: raw };
  }
  let txs: { date: string }[] = [];
  try {
    if (format === "ofx") txs = parseOfxTransactions(buffer);
    else if (format === "ofc") txs = parseOfc(buffer).transactions;
    else {
      const r = await parsePdfStatement(buffer, { fileName });
      if (r.ok) txs = r.transactions;
      else if (r.period) return { competence: r.period.end.slice(0, 7) };
    }
  } catch {
    txs = [];
  }
  const competence = competenceFromTransactions(txs as any);
  return competence
    ? { competence }
    : { error: "não foi possível deduzir a competência pelos lançamentos; informe 'competencia' (AAAA-MM)" };
}

export async function receiveStatement(input: IntakeInput, deps: IntakeDeps): Promise<IntakeResponse> {
  const now = deps.now ? deps.now() : new Date();
  const fileName = (input.fileName || "").replace(/[\\/]/g, "_").trim();

  // 1. Arquivo
  if (!input.buffer?.length) return fail(400, "Envie o arquivo do extrato no campo 'file'.");
  if (input.buffer.length > MAX_FILE_BYTES) return fail(413, "O arquivo passa do limite de 25 MB.");
  const resolved = resolveFormat(fileName, input.buffer);
  if ("error" in resolved) return fail(415, `Arquivo recusado: ${resolved.error}.`);
  const format = resolved.format;

  // 2. Empresa: CNPJ/CPF ou código são obrigatórios
  const cnpj = onlyDigits(input.cnpj) || null;
  const code = (input.empresaCodigo || "").trim() || null;
  const errors: string[] = [];
  if (!cnpj && !code) errors.push("informe 'cnpj' (ou CPF) ou 'empresaCodigo'");
  if (cnpj && cnpj.length !== 14 && cnpj.length !== 11) errors.push("'cnpj' deve ter 14 dígitos (ou 11 para CPF)");

  // 3. Tipo do extrato (padrão: conta corrente)
  const tipoKey = ((input.tipo || "conta_corrente").trim().toLowerCase().replace(/[\s-]+/g, "_")) as StatementTypeKey;
  if (!(tipoKey in STATEMENT_TYPES)) errors.push(`'tipo' deve ser um de: ${Object.keys(STATEMENT_TYPES).join(", ")}`);
  if (errors.length) return fail(400, "Parâmetros inválidos.", errors);

  // 4. Competência (informada ou deduzida)
  const comp = await resolveCompetence(input.competencia, format, input.buffer, fileName);
  if ("error" in comp) return fail(422, `Extrato recusado: ${comp.error}.`);

  // 5. Identificação no cadastro do Gestta (CNPJ e código precisam apontar para a mesma empresa)
  const found = await deps.findCustomer({ cnpj, code });
  if (found.byCnpj && found.byCode && (found.byCnpj.code ?? "") !== (found.byCode.code ?? "")) {
    return fail(422, "O CNPJ e o código informados pertencem a empresas diferentes no cadastro.");
  }
  const customer = found.byCnpj || found.byCode;
  const company = {
    code: customer?.code ?? code,
    cnpj: customer?.cnpj ? onlyDigits(customer.cnpj) : cnpj,
    name: customer?.name || input.empresaNome?.trim() || `Empresa não identificada (${cnpj || code})`,
    identified: Boolean(customer),
  };

  // 6. Mesmo arquivo já recebido: não duplica
  const sha = createHash("sha256").update(input.buffer).digest("hex");
  const documentId = `api:${sha}`;
  const previous = await deps.findReceived(documentId);
  if (previous) {
    return {
      status: 200,
      body: {
        duplicado: true,
        mensagem: "Este arquivo já tinha sido recebido; nada foi alterado.",
        id: previous.id,
        formato: previous.format,
        competencia: previous.competence,
        recebidoEm: previous.uploadedAt,
      },
    };
  }

  // 7. Guarda
  const metadata: Record<string, unknown> = { ...(input.metadata || {}), nomeOriginal: fileName };
  const saved = await deps.save({
    documentId,
    fileName,
    buffer: input.buffer,
    task: {
      id: null,
      name: "Recebido pela API",
      companyName: company.name,
      companyCode: company.code || undefined,
      companyCnpj: company.cnpj || undefined,
      competence: comp.competence,
    },
    documentType: STATEMENT_TYPES[tipoKey],
    uploadedAt: now.toISOString(),
    syncedAt: now.toISOString(),
    received: { tokenId: input.tokenId, metadata },
    declaredStatement: true,
  });
  if (!saved) return fail(415, "Arquivo recusado: o conteúdo não é um extrato OFX, PDF ou OFC válido.");

  // 8. Pós-processamento: falhas aqui não desfazem o recebimento (vão em "avisos")
  const avisos: string[] = [];
  let convertido: Record<string, unknown> | null = null;
  try {
    await deps.copyToDrive(saved, input.buffer);
  } catch (err) {
    avisos.push(`cópia no Drive falhou: ${err instanceof Error ? err.message : err}`);
  }

  const shouldConvert = format === "ofc" || (format === "pdf" && tipoKey === "conta_corrente");
  if (shouldConvert) {
    try {
      const result = format === "ofc" ? await deps.convertOfc(saved, input.buffer) : await deps.convertPdf(saved, input.buffer);
      if (result.ok && !result.already) {
        convertido = { id: result.saved.id, formato: "ofx", nomeArquivo: result.saved.fileName };
        try {
          await deps.copyToDrive(result.saved, result.ofx);
        } catch (err) {
          avisos.push(`cópia do OFX convertido no Drive falhou: ${err instanceof Error ? err.message : err}`);
        }
      } else if (result.ok && result.already) {
        convertido = { id: result.convertedId, formato: "ofx" };
      } else if (!result.ok) {
        avisos.push(`não foi gerado OFX: ${result.reason}`);
      }
    } catch (err) {
      avisos.push(`conversão para OFX falhou: ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    status: 201,
    body: {
      duplicado: false,
      id: saved.id,
      formato: saved.format,
      nomeArquivo: saved.fileName,
      tamanho: saved.fileSize,
      sha256: saved.sha256,
      competencia: saved.competence,
      tipoDocumento: saved.documentType,
      empresa: { codigo: company.code, cnpj: company.cnpj, nome: company.name, identificada: company.identified },
      convertido,
      avisos,
    },
  };
}

// ------------------------------------------------------------------ dependências reais

let customerCache: { at: number; byCnpj: Map<string, CustomerRef>; byCode: Map<string, CustomerRef> } | null = null;
const CUSTOMER_CACHE_MS = 60 * 60 * 1000;

async function loadCustomers() {
  if (customerCache && Date.now() - customerCache.at < CUSTOMER_CACHE_MS) return customerCache;
  const { getGesttaCustomers } = await import("./gestta");
  const first = await getGesttaCustomers({ page: 1, limit: 100 });
  const all = [...first.customers];
  for (let page = 2; page <= first.pages; page++) all.push(...(await getGesttaCustomers({ page, limit: 100 })).customers);
  const byCnpj = new Map<string, CustomerRef>();
  const byCode = new Map<string, CustomerRef>();
  for (const c of all) {
    const ref: CustomerRef = { code: c.code ?? null, name: c.name, cnpj: c.cnpj ?? null };
    const d = onlyDigits(c.cnpj);
    if (d) byCnpj.set(d, ref);
    if (c.code) byCode.set(String(c.code), ref);
  }
  customerCache = { at: Date.now(), byCnpj, byCode };
  return customerCache;
}

export function defaultIntakeDeps(): IntakeDeps {
  return {
    async findCustomer({ cnpj, code }) {
      try {
        const c = await loadCustomers();
        return { byCnpj: cnpj ? c.byCnpj.get(cnpj) ?? null : null, byCode: code ? c.byCode.get(code) ?? null : null };
      } catch (err) {
        // Gestta fora do ar: recebe mesmo assim, com os dados informados
        console.warn("[Recebimento] Cadastro do Gestta indisponível:", err instanceof Error ? err.message : err);
        return { byCnpj: null, byCode: null };
      }
    },
    async findReceived(documentId) {
      const found = (await getCapturedStatements([documentId])).get(documentId);
      if (!found) return null;
      return (await getStatementContent(found.id))?.file ?? null;
    },
    save: saveStatementFromGesttaDocument,
    convertOfc: convertOfcStatement,
    convertPdf: convertPdfStatement,
    async copyToDrive(s, b) {
      const { copyStatementToDrive } = await import("./gestta-statements");
      return copyStatementToDrive(s, b);
    },
  };
}
