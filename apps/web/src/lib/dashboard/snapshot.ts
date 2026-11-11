import { getOptionalSupabaseServerClient } from "../supabase-server";

/**
 * Retrato das tarefas do Gestta para o Painel de pendências.
 *
 * - Funções PURAS de mapeamento: documento da busca -> linha de `gestta_tasks`;
 *   detalhe da tarefa de extratos -> linhas de `gestta_document_requests`.
 * - Gravação em lote (upsert de 500 em 500), tolerante a falha: nunca lança,
 *   devolve contagens e erros para o resumo da captura.
 *
 * Fuso: o Gestta grava as datas como o fim do dia local em UTC
 * ("2026-06-16T02:59:59.999Z" = 15/06 23:59:59 em Brasília). Vencimento e
 * competência são sempre calculados no fuso America/Sao_Paulo.
 */

export const DASHBOARD_TIME_ZONE = "America/Sao_Paulo";
export const UPSERT_BATCH_SIZE = 500;

// Itens da solicitação que são extratos (mesma regra da captura de extratos)
const STATEMENT_ITEM = /^extratos?\b/i;

export interface GesttaTaskRow {
  gestta_task_id: string;
  name: string | null;
  type: string | null;
  status: string | null;
  overdue: boolean;
  done_overdue: boolean;
  due_date: string | null; // AAAA-MM-DD (Brasília)
  competence: string | null; // AAAA-MM (Brasília)
  conclusion_date: string | null;
  created_at_gestta: string | null;
  company_gestta_id: string | null;
  company_code: string | null;
  company_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  steps_total: number | null;
  steps_done: number | null;
  synced_at: string;
  updated_at: string;
}

export interface GesttaDocumentRequestRow {
  gestta_task_id: string;
  requested_document_id: string;
  task_name: string | null;
  company_gestta_id: string | null;
  company_code: string | null;
  company_name: string | null;
  competence: string | null;
  document_name: string | null;
  is_statement: boolean;
  files_count: number;
  disconsidered: boolean;
  last_upload_at: string | null;
  task_status: string | null;
  task_due_date: string | null;
  synced_at: string;
  updated_at: string;
}

// ------------------------------------------------------------------ fuso / datas

let dayFormatter: Intl.DateTimeFormat | null = null;

/** Data (AAAA-MM-DD) no fuso de Brasília. Aceita ISO com hora, data pura ou Date. */
export function saoPauloDate(value: unknown): string | null {
  if (value instanceof Date) return formatDay(value);
  if (typeof value !== "string") return null;
  const raw = value.trim();
  // Data pura (sem hora): já é o dia local, não há o que converter
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : formatDay(date);
}

function formatDay(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  dayFormatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Competência AAAA-MM no fuso de Brasília. Aceita "AAAA-MM", data pura ou ISO com hora. */
export function saoPauloCompetence(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value.trim())) return value.trim();
  const day = saoPauloDate(value);
  return day ? day.slice(0, 7) : null;
}

/**
 * Competência da tarefa: `competence_date` (ou `competence`) convertida para Brasília.
 * Não usa o vencimento como substituto: a tarefa que vence em outubro costuma ser
 * da competência de setembro, então a tarefa sem competência fica com null.
 */
export function taskCompetence(task: any): string | null {
  if (!task) return null;
  return saoPauloCompetence(task.competence_date) ?? saoPauloCompetence(task.competence);
}

/** Instante válido em ISO (UTC) ou null. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ------------------------------------------------------------------ mapeamento

/** Documento da busca de tarefas (`searchGesttaTasksPage`) -> linha de `gestta_tasks`. */
export function mapTaskDocToRow(doc: any, syncedAt: string): GesttaTaskRow | null {
  const id = textOrNull(doc?._id ?? doc?.id);
  if (!id) return null;
  const customer = doc.customer && typeof doc.customer === "object" ? doc.customer : {};
  const owner = doc.owner && typeof doc.owner === "object" ? doc.owner : {};
  return {
    gestta_task_id: id,
    name: textOrNull(doc.name),
    type: textOrNull(doc.type),
    status: textOrNull(doc.status),
    overdue: doc.overdue === true,
    done_overdue: doc.done_overdue === true,
    due_date: saoPauloDate(doc.due_date),
    competence: taskCompetence(doc),
    conclusion_date: isoOrNull(doc.conclusion_date),
    created_at_gestta: isoOrNull(doc.created_at),
    company_gestta_id: textOrNull(customer._id ?? customer.id),
    company_code: textOrNull(customer.code),
    company_name: textOrNull(customer.name),
    owner_id: textOrNull(owner._id ?? owner.id),
    owner_name: textOrNull(owner.name),
    steps_total: intOrNull(doc.total_step),
    steps_done: intOrNull(doc.done_step),
    synced_at: syncedAt,
    updated_at: syncedAt,
  };
}

/**
 * Detalhe da tarefa (`getGesttaTaskDetailWithRetry`) -> uma linha por item de
 * `document_request.requested_documents[]` (inclusive os que não são extrato e os
 * desconsiderados: o painel filtra). `listed` é o documento da busca, usado como
 * reserva para campos ausentes no detalhe.
 */
export function mapTaskDetailToDocumentRequests(
  detail: any,
  listed: any,
  syncedAt: string,
): GesttaDocumentRequestRow[] {
  const taskId = textOrNull(detail?._id ?? detail?.id ?? listed?._id ?? listed?.id);
  if (!taskId) return [];
  const items: any[] = Array.isArray(detail?.document_request?.requested_documents)
    ? detail.document_request.requested_documents
    : [];
  const customer = detail.customer || listed?.customer || {};
  const competence = taskCompetence(detail) ?? taskCompetence(listed);
  const dueDate = saoPauloDate(detail.due_date) ?? saoPauloDate(listed?.due_date);

  const rows: GesttaDocumentRequestRow[] = [];
  for (const item of items) {
    const requestedId = textOrNull(item?._id ?? item?.id);
    if (!requestedId) continue;
    const files: any[] = Array.isArray(item.files) ? item.files : [];
    let lastUpload: number | null = null;
    for (const file of files) {
      for (const raw of [file?.last_upload_date, file?.upload_date]) {
        const iso = isoOrNull(raw);
        if (iso) lastUpload = Math.max(lastUpload ?? 0, Date.parse(iso));
      }
    }
    const name = textOrNull(item.name);
    rows.push({
      gestta_task_id: taskId,
      requested_document_id: requestedId,
      task_name: textOrNull(detail.name ?? listed?.name),
      company_gestta_id: textOrNull(customer._id ?? customer.id),
      company_code: textOrNull(customer.code),
      company_name: textOrNull(customer.name),
      competence,
      document_name: name,
      is_statement: STATEMENT_ITEM.test(name || ""),
      files_count: files.length,
      disconsidered: item.disconsidered === true,
      last_upload_at: lastUpload === null ? null : new Date(lastUpload).toISOString(),
      task_status: textOrNull(detail.status ?? listed?.status),
      task_due_date: dueDate,
      synced_at: syncedAt,
      updated_at: syncedAt,
    });
  }
  return rows;
}

// ------------------------------------------------------------------ gravação

/** Subconjunto do cliente Supabase usado aqui (permite injetar um cliente falso nos testes). */
export interface SnapshotClient {
  from(table: string): {
    upsert(rows: any[], options: { onConflict: string }): PromiseLike<{ error: any }>;
  };
}

export interface SnapshotWriteResult {
  /** false quando não há Supabase configurado (modo memória): nada foi gravado */
  enabled: boolean;
  attempted: number;
  written: number;
  batches: number;
  errors: string[];
}

/** Mantém a última ocorrência de cada chave: um mesmo upsert não pode tocar a linha duas vezes. */
export function dedupeByKey<T>(rows: T[], key: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    map.delete(k);
    map.set(k, row);
  }
  return [...map.values()];
}

function resolveClient(client: SnapshotClient | null | undefined): SnapshotClient | null {
  if (client !== undefined) return client;
  return getOptionalSupabaseServerClient() as unknown as SnapshotClient | null;
}

/**
 * Upsert em lotes. Um lote com erro é registrado e os demais seguem. Nunca lança.
 * `client`: undefined usa o Supabase do ambiente; null (ou ambiente sem Supabase) = no-op.
 */
export async function upsertInBatches<T>(
  table: string,
  rows: T[],
  onConflict: string,
  client?: SnapshotClient | null,
  batchSize = UPSERT_BATCH_SIZE,
): Promise<SnapshotWriteResult> {
  const result: SnapshotWriteResult = {
    enabled: false,
    attempted: rows.length,
    written: 0,
    batches: 0,
    errors: [],
  };
  let db: SnapshotClient | null;
  try {
    db = resolveClient(client);
  } catch (err: any) {
    result.errors.push(`${table}: ${err?.message || String(err)}`);
    return result;
  }
  if (!db) return result;
  result.enabled = true;

  const size = Math.max(1, Math.floor(batchSize));
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    result.batches++;
    try {
      const { error } = await db.from(table).upsert(batch, { onConflict });
      if (error) throw error;
      result.written += batch.length;
    } catch (err: any) {
      result.errors.push(
        `${table} (linhas ${i + 1}-${i + batch.length}): ${err?.message || String(err)}`,
      );
    }
  }
  return result;
}

/** Grava o retrato das tarefas (`gestta_tasks`). */
export function saveTaskSnapshot(rows: GesttaTaskRow[], client?: SnapshotClient | null) {
  const unique = dedupeByKey(rows, (r) => r.gestta_task_id);
  return upsertInBatches("gestta_tasks", unique, "gestta_task_id", client);
}

/** Grava os itens de solicitação de documentos (`gestta_document_requests`). */
export function saveDocumentRequests(
  rows: GesttaDocumentRequestRow[],
  client?: SnapshotClient | null,
) {
  const unique = dedupeByKey(rows, (r) => `${r.gestta_task_id}|${r.requested_document_id}`);
  return upsertInBatches(
    "gestta_document_requests",
    unique,
    "gestta_task_id,requested_document_id",
    client,
  );
}
