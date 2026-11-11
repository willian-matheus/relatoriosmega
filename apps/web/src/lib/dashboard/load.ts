import type {
  DashboardInput,
  DocumentRequestInput,
  HistoryRecordInput,
  StatementFileInput,
  SyncLogInput,
  TaskInput,
} from "./aggregate";

/**
 * Leitura das tabelas do Painel no Supabase (sem chamar o Gestta).
 * O PostgREST devolve no máximo 1000 linhas por requisição: leituras grandes
 * são paginadas com `.range()` até a página vir incompleta.
 */

export const PAGE_SIZE = 1000;
const MAX_PAGES = 200; // trava de segurança: 200 mil linhas

/**
 * Pagina uma consulta. `build` deve devolver a consulta com ordenação estável, sem `.range()`.
 * Com `concurrency` > 1, lê as páginas em ondas paralelas (ex.: 6 por vez) e para na
 * primeira página incompleta; páginas posteriores da mesma onda são descartadas.
 */
export async function fetchAllPages<T>(
  build: () => { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: any }> },
  pageSize = PAGE_SIZE,
  concurrency = 1,
): Promise<T[]> {
  const all: T[] = [];
  const wave = Math.max(1, Math.floor(concurrency));
  for (let start = 0; start < MAX_PAGES; start += wave) {
    const pages = Array.from({ length: Math.min(wave, MAX_PAGES - start) }, (_, i) => start + i);
    const results = await Promise.all(
      pages.map(async (page) => {
        const from = page * pageSize;
        const { data, error } = await build().range(from, from + pageSize - 1);
        if (error) throw new Error(error.message || String(error));
        return data || [];
      }),
    );
    for (const rows of results) {
      all.push(...rows);
      if (rows.length < pageSize) return all;
    }
  }
  return all;
}

/** Ondas de leitura paralela usadas pelo Painel */
export const DASHBOARD_READ_CONCURRENCY = 6;

const TASK_COLUMNS =
  "gestta_task_id, name, status, overdue, done_overdue, due_date, competence, company_gestta_id, company_code, company_name, owner_id, owner_name, synced_at";
const REQUEST_COLUMNS =
  "gestta_task_id, requested_document_id, task_name, company_gestta_id, company_code, company_name, competence, document_name, is_statement, files_count, disconsidered, task_status, task_due_date";
const STATEMENT_COLUMNS =
  "id, format, company_code, drive_file_id, converted_from_id, delivery_status, synced_at";
const HISTORY_COLUMNS = "id, company_code, drive_pdf_link, drive_file_link, synced_at";

export async function loadDashboardInput(
  supabase: any,
  options: { empresa?: string | null; execucoes?: number } = {},
): Promise<DashboardInput> {
  const empresa = options.empresa?.trim() || null;

  // Retrato atual: somente a varredura mais recente de gestta_tasks
  const latest = await supabase
    .from("gestta_tasks")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1);
  if (latest.error) throw new Error(latest.error.message);
  const syncedAt: string | undefined = latest.data?.[0]?.synced_at;

  const C = DASHBOARD_READ_CONCURRENCY;
  const tasksP: Promise<TaskInput[]> = syncedAt
    ? fetchAllPages<TaskInput>(() => {
        let q = supabase.from("gestta_tasks").select(TASK_COLUMNS).eq("synced_at", syncedAt);
        if (empresa) q = q.eq("company_code", empresa);
        return q.order("gestta_task_id", { ascending: true });
      }, PAGE_SIZE, C)
    : Promise.resolve([]);

  const documentRequestsP = fetchAllPages<DocumentRequestInput>(() => {
    let q = supabase.from("gestta_document_requests").select(REQUEST_COLUMNS);
    if (empresa) q = q.eq("company_code", empresa);
    return q
      .order("gestta_task_id", { ascending: true })
      .order("requested_document_id", { ascending: true });
  }, PAGE_SIZE, C);

  const statementFilesP = fetchAllPages<StatementFileInput>(() => {
    let q = supabase.from("gestta_statement_files").select(STATEMENT_COLUMNS);
    if (empresa) q = q.eq("company_code", empresa);
    return q.order("id", { ascending: true });
  }, PAGE_SIZE, C);

  const historyRecordsP = fetchAllPages<HistoryRecordInput>(() => {
    let q = supabase.from("gestta_history_records").select(HISTORY_COLUMNS);
    if (empresa) q = q.eq("company_code", empresa);
    return q.order("id", { ascending: true });
  }, PAGE_SIZE, C);

  const [tasks, documentRequests, statementFiles, historyRecords] = await Promise.all([
    tasksP,
    documentRequestsP,
    statementFilesP,
    historyRecordsP,
  ]);

  // `*`: algumas instalações têm error_message, outras não
  const logs = await supabase
    .from("gestta_sync_logs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(Math.max(1, options.execucoes ?? 10));
  if (logs.error) throw new Error(logs.error.message);
  const syncLogs: SyncLogInput[] = logs.data || [];

  return { tasks, documentRequests, statementFiles, historyRecords, syncLogs };
}
