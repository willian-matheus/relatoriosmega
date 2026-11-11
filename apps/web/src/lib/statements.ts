import { createHash, randomUUID } from "node:crypto";
import { getOptionalSupabaseServerClient } from "./supabase-server";

/**
 * Extratos bancários (OFX/PDF/OFC) capturados dos anexos das tarefas do Gestta ou
 * recebidos de outras plataformas pela API, disponibilizados via API com token.
 */

export type StatementFormat = "ofx" | "pdf" | "ofc";
/** De onde veio o extrato */
export type StatementSource = "gestta" | "api";

export const STATEMENTS_BUCKET = "statements";

const CONTENT_TYPES: Record<StatementFormat, string> = {
  ofx: "application/x-ofx",
  pdf: "application/pdf",
  ofc: "application/x-ofc",
};

// Palavras que identificam um PDF como extrato bancário (no nome do arquivo ou no
// contexto, ex.: "Extratos de Conta Corrente"). "Extrato FGTS" não é extrato bancário.
const STATEMENT_KEYWORDS = /extrato|statement|banc[aá]ri[oa]/i;
const NOT_BANK_STATEMENT = /fgts/i;

function looksLikeBankStatement(text: string): boolean {
  return STATEMENT_KEYWORDS.test(text) && !NOT_BANK_STATEMENT.test(text);
}

export interface StatementFile {
  id: string;
  gesttaDocumentId: string;
  /** null nos extratos recebidos pela API (não vêm de tarefa do Gestta) */
  gesttaTaskId: string | null;
  source: StatementSource;
  receivedByTokenId: string | null;
  taskName: string | null;
  companyName: string;
  companyCode: string | null;
  companyCnpj: string | null;
  competence: string | null;
  documentType: string | null;
  format: StatementFormat;
  fileName: string;
  contentType: string;
  fileSize: number;
  sha256: string;
  uploadedAt: string | null;
  syncedAt: string;
  driveFileId: string | null;
  driveFileLink: string | null;
  /** Preenchido quando este OFX foi gerado a partir de um PDF */
  convertedFromId: string | null;
  conversionNote: string | null;
}

interface StatementRow {
  id: string;
  gestta_document_id: string;
  gestta_task_id: string | null;
  source?: StatementSource;
  received_by_token_id?: string | null;
  received_metadata?: Record<string, unknown> | null;
  task_name: string | null;
  company_name: string;
  company_code: string | null;
  company_cnpj: string | null;
  competence: string | null;
  document_type: string | null;
  format: StatementFormat;
  file_name: string;
  content_type: string;
  file_size: number;
  sha256: string;
  storage_path: string;
  uploaded_at: string | null;
  synced_at: string;
  drive_file_id?: string | null;
  drive_file_link?: string | null;
  converted_from_id?: string | null;
  conversion_note?: string | null;
}

// Fallback em memória quando o Supabase não está configurado
const memoryStatements = new Map<string, { row: StatementRow; buffer: Buffer }>();

function toFile(row: StatementRow): StatementFile {
  return {
    id: row.id,
    gesttaDocumentId: row.gestta_document_id,
    gesttaTaskId: row.gestta_task_id,
    source: row.source ?? "gestta",
    receivedByTokenId: row.received_by_token_id ?? null,
    taskName: row.task_name,
    companyName: row.company_name,
    companyCode: row.company_code,
    companyCnpj: row.company_cnpj,
    competence: row.competence,
    documentType: row.document_type,
    format: row.format,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSize: Number(row.file_size) || 0,
    sha256: row.sha256,
    uploadedAt: row.uploaded_at,
    syncedAt: row.synced_at,
    driveFileId: row.drive_file_id ?? null,
    driveFileLink: row.drive_file_link ?? null,
    convertedFromId: row.converted_from_id ?? null,
    conversionNote: row.conversion_note ?? null,
  };
}

export function onlyDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

function safeSegment(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "arquivo"
  );
}

/**
 * Identifica o formato do extrato pelo conteúdo do arquivo (não confia apenas na extensão).
 * PDFs só contam como extrato quando o nome do arquivo ou o contexto indicam extrato bancário.
 */
export function detectStatementFormat(input: {
  fileName: string;
  buffer: Buffer;
  context?: string;
}): StatementFormat | null {
  const head = input.buffer.subarray(0, 2048).toString("latin1");
  if (/^\s*OFXHEADER\s*:/i.test(head) || /<\?OFX\b/i.test(head) || /<OFX>/i.test(head)) {
    return "ofx";
  }
  // OFC (Open Financial Connectivity, formato antigo do Microsoft Money)
  if (/^\s*OFCHEADER\s*:/i.test(head) || /<OFC>/i.test(head)) {
    return "ofc";
  }
  if (head.startsWith("%PDF-")) {
    const ok =
      looksLikeBankStatement(input.fileName) || looksLikeBankStatement(input.context || "");
    return ok ? "pdf" : null;
  }
  return null;
}

/**
 * Dos ids de arquivo do Gestta informados, retorna os já capturados
 * (id do extrato e se já tem cópia no Google Drive).
 */
export async function getCapturedStatements(
  gesttaDocumentIds: string[],
): Promise<Map<string, { id: string; driveFileId: string | null }>> {
  const result = new Map<string, { id: string; driveFileId: string | null }>();
  if (!gesttaDocumentIds.length) return result;
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const wanted = new Set(gesttaDocumentIds);
    for (const { row } of memoryStatements.values()) {
      if (wanted.has(row.gestta_document_id)) {
        result.set(row.gestta_document_id, { id: row.id, driveFileId: row.drive_file_id ?? null });
      }
    }
    return result;
  }
  const { data, error } = await (supabase as any)
    .from("gestta_statement_files")
    .select("id, gestta_document_id, drive_file_id")
    .in("gestta_document_id", gesttaDocumentIds);
  if (error) throw new Error(`Falha ao consultar extratos já capturados: ${error.message}`);
  for (const r of data as { id: string; gestta_document_id: string; drive_file_id: string | null }[]) {
    result.set(r.gestta_document_id, { id: r.id, driveFileId: r.drive_file_id });
  }
  return result;
}

/** Registra a cópia do extrato no Google Drive. */
export async function setStatementDriveFile(
  id: string,
  drive: { fileId: string; link: string | null },
): Promise<void> {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const entry = memoryStatements.get(id);
    if (entry) {
      entry.row.drive_file_id = drive.fileId;
      entry.row.drive_file_link = drive.link;
    }
    return;
  }
  const { error } = await (supabase as any)
    .from("gestta_statement_files")
    .update({ drive_file_id: drive.fileId, drive_file_link: drive.link })
    .eq("id", id);
  if (error) throw new Error(`Falha ao registrar cópia no Drive: ${error.message}`);
}

function normalizeFileName(fileName: string, format: StatementFormat): string {
  const base = fileName.replace(/\.(pdf|ofx|qfx|ofc)$/i, "") || "extrato";
  return `${base}.${format}`;
}

/**
 * Salva um anexo do Gestta como extrato, se for OFX ou PDF de extrato.
 * Retorna o registro salvo ou null quando o arquivo não é extrato.
 */
export async function saveStatementFromGesttaDocument(input: {
  documentId: string;
  fileName: string;
  buffer: Buffer;
  task: {
    /** null nos extratos recebidos pela API */
    id: string | null;
    name: string;
    companyName: string;
    companyCode?: string;
    companyCnpj?: string;
    competence?: string;
  };
  /** Documento solicitado ao cliente, ex.: "Extratos de Conta Corrente (em .OFX e em .PDF)" */
  documentType?: string;
  uploadedAt?: string;
  syncedAt: string;
  /** OFX gerado a partir de um PDF: id do extrato PDF de origem e observação */
  conversion?: { fromId: string; note: string };
  /** Recebido pela API: token remetente e dados informados por ele */
  received?: { tokenId: string | null; metadata?: Record<string, unknown> | null };
  /** O remetente declarou que é extrato bancário (vale como contexto do PDF) */
  declaredStatement?: boolean;
}): Promise<StatementFile | null> {
  const format = detectStatementFormat({
    fileName: input.fileName,
    buffer: input.buffer,
    // O documento solicitado (ex.: "Extratos de Conta Corrente") é o melhor contexto;
    // o nome da tarefa vale só quando ele não existe.
    context: input.declaredStatement ? "extrato bancário" : input.documentType || input.task.name,
  });
  if (!format) return null;

  const fileName = normalizeFileName(input.fileName, format);
  const companyKey = onlyDigits(input.task.companyCnpj) || safeSegment(input.task.companyName);
  const storagePath = [
    companyKey,
    safeSegment(input.task.competence || "sem-competencia"),
    `${safeSegment(input.documentId)}-${safeSegment(fileName)}`,
  ].join("/");

  const row: Omit<StatementRow, "id" | "drive_file_id" | "drive_file_link"> = {
    gestta_document_id: input.documentId,
    gestta_task_id: input.task.id,
    source: input.received ? "api" : "gestta",
    received_by_token_id: input.received?.tokenId ?? null,
    received_metadata: input.received?.metadata ?? null,
    task_name: input.task.name || null,
    company_name: input.task.companyName,
    company_code: input.task.companyCode || null,
    company_cnpj: input.task.companyCnpj || null,
    competence: input.task.competence || null,
    document_type: input.documentType || null,
    format,
    file_name: fileName,
    content_type: CONTENT_TYPES[format],
    file_size: input.buffer.length,
    sha256: createHash("sha256").update(input.buffer).digest("hex"),
    storage_path: storagePath,
    uploaded_at: input.uploadedAt || null,
    synced_at: input.syncedAt,
    converted_from_id: input.conversion?.fromId ?? null,
    conversion_note: input.conversion?.note ?? null,
  };

  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const existing = [...memoryStatements.values()].find(
      (s) => s.row.gestta_document_id === input.documentId,
    );
    const full: StatementRow = {
      id: existing?.row.id || randomUUID(),
      drive_file_id: existing?.row.drive_file_id ?? null,
      drive_file_link: existing?.row.drive_file_link ?? null,
      ...row,
    };
    memoryStatements.set(full.id, { row: full, buffer: input.buffer });
    return toFile(full);
  }

  const { error: uploadError } = await (supabase as any).storage
    .from(STATEMENTS_BUCKET)
    .upload(storagePath, input.buffer, { contentType: row.content_type, upsert: true });
  if (uploadError) {
    throw new Error(`Falha ao salvar extrato no Storage: ${uploadError.message}`);
  }

  const { data, error } = await (supabase as any)
    .from("gestta_statement_files")
    .upsert(row, { onConflict: "gestta_document_id" })
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao registrar extrato: ${error.message}`);
  return toFile(data as StatementRow);
}

export interface StatementFilter {
  format?: StatementFormat;
  competence?: string;
  cnpj?: string;
  since?: string;
  page: number;
  limit: number;
}

export async function listStatements(
  filter: StatementFilter,
): Promise<{ items: StatementFile[]; total: number }> {
  const supabase = getOptionalSupabaseServerClient();
  const offset = (filter.page - 1) * filter.limit;

  if (!supabase) {
    const cnpj = onlyDigits(filter.cnpj);
    const rows = [...memoryStatements.values()]
      .map((s) => s.row)
      .filter((r) => !filter.format || r.format === filter.format)
      .filter((r) => !filter.competence || r.competence === filter.competence)
      .filter((r) => !cnpj || onlyDigits(r.company_cnpj) === cnpj)
      .filter((r) => !filter.since || r.synced_at >= filter.since)
      .sort((a, b) => b.synced_at.localeCompare(a.synced_at));
    return {
      items: rows.slice(offset, offset + filter.limit).map(toFile),
      total: rows.length,
    };
  }

  let query = (supabase as any)
    .from("gestta_statement_files")
    .select("*", { count: "exact" })
    .order("synced_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + filter.limit - 1);

  if (filter.format) query = query.eq("format", filter.format);
  if (filter.competence) query = query.eq("competence", filter.competence);
  if (filter.since) query = query.gte("synced_at", filter.since);
  if (filter.cnpj) {
    // O Gestta pode devolver o CNPJ com ou sem máscara
    const digits = onlyDigits(filter.cnpj);
    const masked = digits
      .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
      .replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
    query = query.in("company_cnpj", [...new Set([digits, masked])]);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Não foi possível listar os extratos: ${error.message}`);
  return { items: (data as StatementRow[]).map(toFile), total: count ?? 0 };
}

export async function getStatementContent(
  id: string,
): Promise<{ file: StatementFile; buffer: Buffer } | null> {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const entry = memoryStatements.get(id);
    return entry ? { file: toFile(entry.row), buffer: entry.buffer } : null;
  }

  const { data: row, error } = await (supabase as any)
    .from("gestta_statement_files")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível consultar o extrato: ${error.message}`);
  if (!row) return null;

  const { data: blob, error: dlError } = await (supabase as any).storage
    .from(STATEMENTS_BUCKET)
    .download(row.storage_path);
  if (dlError || !blob) {
    throw new Error(`Arquivo do extrato indisponível: ${dlError?.message || "não encontrado"}`);
  }
  return { file: toFile(row), buffer: Buffer.from(await blob.arrayBuffer()) };
}
