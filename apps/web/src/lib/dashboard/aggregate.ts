import { saoPauloCompetence, saoPauloDate } from "./snapshot";

/**
 * Cálculos do Painel de pendências. Funções PURAS: recebem as linhas já lidas do
 * Supabase e devolvem o JSON do painel (`DashboardData`). Não acessam rede nem banco.
 */

// ------------------------------------------------------------------ entrada

/** Linha de `gestta_tasks` (somente as colunas usadas). */
export interface TaskInput {
  gestta_task_id: string;
  name?: string | null;
  status?: string | null;
  overdue?: boolean | null;
  done_overdue?: boolean | null;
  due_date?: string | null;
  competence?: string | null;
  company_gestta_id?: string | null;
  company_code?: string | null;
  company_name?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  synced_at?: string | null;
}

/** Linha de `gestta_document_requests` (somente as colunas usadas). */
export interface DocumentRequestInput {
  gestta_task_id: string;
  requested_document_id?: string | null;
  task_name?: string | null;
  company_gestta_id?: string | null;
  company_code?: string | null;
  company_name?: string | null;
  competence?: string | null;
  document_name?: string | null;
  is_statement?: boolean | null;
  files_count?: number | null;
  disconsidered?: boolean | null;
  task_status?: string | null;
  task_due_date?: string | null;
}

/** Linha de `gestta_statement_files` (somente as colunas usadas). */
export interface StatementFileInput {
  format?: string | null;
  company_code?: string | null;
  drive_file_id?: string | null;
  converted_from_id?: string | null;
  delivery_status?: string | null;
  synced_at?: string | null;
}

/** Linha de `gestta_history_records` (somente as colunas usadas). */
export interface HistoryRecordInput {
  company_code?: string | null;
  drive_pdf_link?: string | null;
  drive_file_link?: string | null;
  synced_at?: string | null;
}

/** Linha de `gestta_sync_logs`. */
export interface SyncLogInput {
  id?: string | number | null;
  started_at?: string | null;
  finished_at?: string | null;
  status?: string | null;
  tasks_checked?: number | null;
  companies_count?: number | null;
  error_message?: string | null;
  metadata?: Record<string, any> | null;
}

export interface DashboardInput {
  tasks: TaskInput[];
  documentRequests: DocumentRequestInput[];
  statementFiles: StatementFileInput[];
  historyRecords: HistoryRecordInput[];
  syncLogs: SyncLogInput[];
}

export interface DashboardOptions {
  /** Quantas competências na série (padrão 6, de 1 a 36) */
  competencias?: number;
  /** Filtro por código da empresa */
  empresa?: string | null;
  /** Filtro por nome do responsável (sem diferenciar maiúsculas) */
  responsavel?: string | null;
  /** Tamanho dos rankings (padrão 10) */
  top?: number;
  /** Quantas execuções da sincronização listar (padrão 10) */
  execucoes?: number;
  /** Instante de referência (padrão: agora). A série termina na competência deste instante. */
  now?: Date;
}

// ------------------------------------------------------------------ saída

export interface DashboardKpis {
  total: number;
  emAberto: number; // OPEN (no prazo + atrasadas)
  atrasadas: number; // OPEN e overdue
  concluidas: number; // DONE
  concluidasComAtraso: number; // DONE e done_overdue
  desconsideradas: number; // DISCONSIDERED
  /** concluídas no prazo / concluídas x 100 (1 casa); null sem tarefas concluídas */
  percentualNoPrazo: number | null;
}

export interface CompetenceSeriesPoint {
  competencia: string; // AAAA-MM
  concluidasNoPrazo: number;
  concluidasComAtraso: number;
  abertasNoPrazo: number;
  atrasadas: number;
  desconsideradas: number;
}

export interface RankingItem {
  /** Código da empresa ou id do responsável (null quando ausente) */
  id: string | null;
  codigo: string | null; // código da empresa (só no ranking de empresas)
  nome: string;
  atrasadas: number;
  emAberto: number;
}

export interface MissingDocumentsGroup {
  competencia: string | null;
  solicitados: number;
  recebidos: number;
  faltando: number;
  /** faltando em tarefas já vencidas (vencimento antes de hoje, em Brasília) */
  faltandoVencidos: number;
}

export interface MissingDocumentsCompany {
  codigo: string | null;
  nome: string;
  faltando: number;
  competencias: string[];
}

export interface MissingDocumentsItem {
  tarefaId: string;
  tarefa: string | null;
  empresaCodigo: string | null;
  empresaNome: string;
  competencia: string | null;
  documentosFaltantes: string[];
  vencimento: string | null; // AAAA-MM-DD
  /** a tarefa já venceu (vencimento antes de hoje, em Brasília) */
  vencido: boolean;
  /** itens de extrato da tarefa: solicitados e recebidos (para "nenhum" x "parcial") */
  solicitados: number;
  recebidos: number;
  statusTarefa: string | null;
}

export interface SyncRun {
  id: string | null;
  inicio: string | null;
  fim: string | null;
  status: string | null; // running | success | error
  erro: string | null;
  tarefasVerificadas: number | null;
  empresas: number | null;
  duracaoSegundos: number | null;
}

export interface DashboardData {
  geradoEm: string;
  filtros: { competencias: number; empresa: string | null; responsavel: string | null };
  /** Varredura que gerou o retrato das tarefas (synced_at mais recente) */
  retrato: { sincronizadoEm: string | null; tarefas: number };
  kpis: DashboardKpis;
  serie: CompetenceSeriesPoint[];
  ranking: { empresas: RankingItem[]; responsaveis: RankingItem[] };
  documentos: {
    /** faltando = faltandoVencidos + faltandoAVencer (sem vencimento conta como a vencer) */
    totais: {
      solicitados: number;
      recebidos: number;
      faltando: number;
      faltandoVencidos: number;
      faltandoAVencer: number;
      /** tarefas de extrato em aberto sem NENHUM extrato recebido (o cliente não mandou nada) */
      tarefasSemExtrato: number;
      /** ...das quais já vencidas */
      tarefasSemExtratoVencidas: number;
      /** tarefas em aberto com parte dos extratos recebida */
      tarefasParciais: number;
    };
    porCompetencia: MissingDocumentsGroup[];
    porEmpresa: MissingDocumentsCompany[];
    pendencias: MissingDocumentsItem[];
  };
  drive: {
    extratos: {
      total: number;
      ofx: number;
      pdf: number;
      comCopiaDrive: number;
      semCopiaDrive: number;
      convertidos: number;
      ultimaCaptura: string | null;
    };
    envioCrm: { enviado: number; erro: number; nao_enviar: number; pendente: number };
    historico: { tarefas: number; comPdfNoDrive: number; comArquivoNoDrive: number };
    ultimaSincronizacao: SyncRun | null;
    execucoes: SyncRun[];
  };
}

// ------------------------------------------------------------------ utilitários

const SEM_EMPRESA = "Empresa não identificada";
const SEM_RESPONSAVEL = "Sem responsável";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const time = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};
const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : def;
};

/** Competências AAAA-MM terminando em `end`, em ordem cronológica. */
export function lastCompetences(end: string, count: number): string[] {
  const [y, m] = end.split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Retrato atual: somente as linhas da varredura mais recente (maior synced_at).
 * Tarefas que saíram da janela ou foram excluídas no Gestta ficam no banco com
 * synced_at antigo e não contam. Linhas sem synced_at são mantidas só se nenhuma tiver.
 */
export function currentSnapshot<T extends { synced_at?: string | null }>(rows: T[]): T[] {
  let latest: number | null = null;
  for (const r of rows) {
    const t = time(r.synced_at);
    if (t !== null && (latest === null || t > latest)) latest = t;
  }
  if (latest === null) return rows;
  return rows.filter((r) => time(r.synced_at) === latest);
}

const isOpen = (t: TaskInput) => t.status === "OPEN";
const isLate = (t: TaskInput) => isOpen(t) && t.overdue === true;
const isDone = (t: TaskInput) => t.status === "DONE";

// ------------------------------------------------------------------ cálculos

export function computeKpis(tasks: TaskInput[]): DashboardKpis {
  const k: DashboardKpis = {
    total: tasks.length,
    emAberto: 0,
    atrasadas: 0,
    concluidas: 0,
    concluidasComAtraso: 0,
    desconsideradas: 0,
    percentualNoPrazo: null,
  };
  for (const t of tasks) {
    if (isOpen(t)) {
      k.emAberto++;
      if (isLate(t)) k.atrasadas++;
    } else if (isDone(t)) {
      k.concluidas++;
      if (t.done_overdue === true) k.concluidasComAtraso++;
    } else if (t.status === "DISCONSIDERED") {
      k.desconsideradas++;
    }
  }
  if (k.concluidas > 0) {
    k.percentualNoPrazo =
      Math.round(((k.concluidas - k.concluidasComAtraso) / k.concluidas) * 1000) / 10;
  }
  return k;
}

export function computeSeries(
  tasks: TaskInput[],
  count: number,
  endCompetence: string,
): CompetenceSeriesPoint[] {
  const points = new Map<string, CompetenceSeriesPoint>();
  for (const c of lastCompetences(endCompetence, count)) {
    points.set(c, {
      competencia: c,
      concluidasNoPrazo: 0,
      concluidasComAtraso: 0,
      abertasNoPrazo: 0,
      atrasadas: 0,
      desconsideradas: 0,
    });
  }
  for (const t of tasks) {
    const p = t.competence ? points.get(t.competence) : undefined;
    if (!p) continue;
    if (isOpen(t)) {
      if (isLate(t)) p.atrasadas++;
      else p.abertasNoPrazo++;
    } else if (isDone(t)) {
      if (t.done_overdue === true) p.concluidasComAtraso++;
      else p.concluidasNoPrazo++;
    } else if (t.status === "DISCONSIDERED") {
      p.desconsideradas++;
    }
  }
  return [...points.values()];
}

function rank(
  tasks: TaskInput[],
  keyOf: (t: TaskInput) => { key: string; id: string | null; codigo: string | null; nome: string },
  top: number,
): RankingItem[] {
  const groups = new Map<string, RankingItem>();
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    const k = keyOf(t);
    let g = groups.get(k.key);
    if (!g) {
      g = { id: k.id, codigo: k.codigo, nome: k.nome, atrasadas: 0, emAberto: 0 };
      groups.set(k.key, g);
    }
    g.emAberto++;
    if (isLate(t)) g.atrasadas++;
  }
  // Mais atrasadas primeiro; empate -> mais em aberto; empate -> nome (ordem estável)
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.atrasadas - a.atrasadas ||
        b.emAberto - a.emAberto ||
        a.nome.localeCompare(b.nome, "pt-BR") ||
        (a.codigo ?? "").localeCompare(b.codigo ?? ""),
    )
    .slice(0, top);
}

export function computeRankings(tasks: TaskInput[], top: number) {
  return {
    empresas: rank(
      tasks,
      (t) => {
        const codigo = t.company_code?.trim() || null;
        const nome = t.company_name?.trim() || SEM_EMPRESA;
        const key = codigo ? `c:${codigo}` : t.company_gestta_id ? `g:${t.company_gestta_id}` : `n:${norm(nome)}`;
        return { key, id: codigo ?? t.company_gestta_id ?? null, codigo, nome };
      },
      top,
    ),
    responsaveis: rank(
      tasks,
      (t) => {
        const nome = t.owner_name?.trim() || SEM_RESPONSAVEL;
        const key = t.owner_id ? `i:${t.owner_id}` : `n:${norm(nome)}`;
        return { key, id: t.owner_id ?? null, codigo: null, nome };
      },
      top,
    ),
  };
}

/** Item de extrato que conta para o painel: é extrato, não foi desconsiderado e a tarefa não foi desconsiderada. */
const countsAsRequested = (d: DocumentRequestInput) =>
  d.is_statement === true && d.disconsidered !== true && d.task_status !== "DISCONSIDERED";
// Tarefa concluída pelo escritório não é pendência: itens sem arquivo ali não eram aplicáveis
const isClosed = (d: DocumentRequestInput) => d.task_status === "DONE";
const isMissing = (d: DocumentRequestInput) =>
  countsAsRequested(d) && !isClosed(d) && !(Number(d.files_count) > 0);

export function computeMissingDocuments(
  requests: DocumentRequestInput[],
  today: string | null = null,
): DashboardData["documentos"] {
  const totais = {
    solicitados: 0,
    recebidos: 0,
    faltando: 0,
    faltandoVencidos: 0,
    faltandoAVencer: 0,
    tarefasSemExtrato: 0,
    tarefasSemExtratoVencidas: 0,
    tarefasParciais: 0,
  };
  // Itens por tarefa (só tarefas não concluídas), para contar clientes sem nenhum extrato
  const perTask = new Map<string, { solicitados: number; recebidos: number; vencido: boolean }>();
  // Vencida = vencimento estritamente antes de hoje (AAAA-MM-DD compara como texto)
  const overdue = (d: DocumentRequestInput) => Boolean(today && d.task_due_date && d.task_due_date < today);
  const byCompetence = new Map<string, MissingDocumentsGroup>();
  const byCompany = new Map<string, MissingDocumentsCompany & { _comp: Set<string> }>();
  const byTask = new Map<string, MissingDocumentsItem>();

  for (const d of requests) {
    if (!countsAsRequested(d)) continue;
    const missing = isMissing(d);
    // solicitados e recebidos incluem tarefas concluídas; "faltando" só conta tarefas não concluídas
    totais.solicitados++;
    if (!isClosed(d)) {
      const t = perTask.get(d.gestta_task_id) ?? { solicitados: 0, recebidos: 0, vencido: overdue(d) };
      t.solicitados++;
      if (Number(d.files_count) > 0) t.recebidos++;
      perTask.set(d.gestta_task_id, t);
    }
    const late = missing && overdue(d);
    if (missing) {
      totais.faltando++;
      if (late) totais.faltandoVencidos++;
      else totais.faltandoAVencer++;
    } else if (Number(d.files_count) > 0) totais.recebidos++;

    const compKey = d.competence ?? "";
    let g = byCompetence.get(compKey);
    if (!g) {
      g = { competencia: d.competence ?? null, solicitados: 0, recebidos: 0, faltando: 0, faltandoVencidos: 0 };
      byCompetence.set(compKey, g);
    }
    g.solicitados++;
    if (missing) g.faltando++;
    else if (Number(d.files_count) > 0) g.recebidos++;
    if (late) g.faltandoVencidos++;

    if (!missing) continue;

    const codigo = d.company_code?.trim() || null;
    const nome = d.company_name?.trim() || SEM_EMPRESA;
    const companyKey = codigo ? `c:${codigo}` : d.company_gestta_id ? `g:${d.company_gestta_id}` : `n:${norm(nome)}`;
    let c = byCompany.get(companyKey);
    if (!c) {
      c = { codigo, nome, faltando: 0, competencias: [], _comp: new Set() };
      byCompany.set(companyKey, c);
    }
    c.faltando++;
    if (d.competence) c._comp.add(d.competence);

    let item = byTask.get(d.gestta_task_id);
    if (!item) {
      item = {
        tarefaId: d.gestta_task_id,
        tarefa: d.task_name ?? null,
        empresaCodigo: codigo,
        empresaNome: nome,
        competencia: d.competence ?? null,
        documentosFaltantes: [],
        vencimento: d.task_due_date ?? null,
        vencido: overdue(d),
        solicitados: 0,
        recebidos: 0,
        statusTarefa: d.task_status ?? null,
      };
      byTask.set(d.gestta_task_id, item);
    }
    item.documentosFaltantes.push(d.document_name?.trim() || "Documento sem nome");
  }

  for (const [taskId, t] of perTask) {
    if (t.recebidos === 0) {
      totais.tarefasSemExtrato++;
      if (t.vencido) totais.tarefasSemExtratoVencidas++;
    } else if (t.recebidos < t.solicitados) totais.tarefasParciais++;
    const item = byTask.get(taskId);
    if (item) {
      item.solicitados = t.solicitados;
      item.recebidos = t.recebidos;
    }
  }

  // Sem competência por último
  const porCompetencia = [...byCompetence.values()].sort((a, b) =>
    a.competencia === b.competencia ? 0 : a.competencia === null ? 1 : b.competencia === null ? -1 : a.competencia.localeCompare(b.competencia),
  );
  const porEmpresa = [...byCompany.values()]
    .map(({ _comp, ...c }) => ({ ...c, competencias: [..._comp].sort() }))
    .sort((a, b) => b.faltando - a.faltando || a.nome.localeCompare(b.nome, "pt-BR"));
  // Vencimento mais antigo primeiro (sem vencimento por último)
  const pendencias = [...byTask.values()].sort(
    (a, b) =>
      (a.vencimento ?? "9999-99-99").localeCompare(b.vencimento ?? "9999-99-99") ||
      a.empresaNome.localeCompare(b.empresaNome, "pt-BR") ||
      a.tarefaId.localeCompare(b.tarefaId),
  );
  return { totais, porCompetencia, porEmpresa, pendencias };
}

function toSyncRun(log: SyncLogInput): SyncRun {
  const start = time(log.started_at);
  const end = time(log.finished_at);
  const metaError = log.metadata && typeof log.metadata === "object" ? log.metadata.error : null;
  return {
    id: log.id === null || log.id === undefined ? null : String(log.id),
    inicio: log.started_at ?? null,
    fim: log.finished_at ?? null,
    status: log.status ?? null,
    erro: log.error_message || (typeof metaError === "string" ? metaError : null) || null,
    tarefasVerificadas: log.tasks_checked ?? null,
    empresas: log.companies_count ?? null,
    duracaoSegundos: start !== null && end !== null && end >= start ? Math.round((end - start) / 1000) : null,
  };
}

export function computeDriveStatus(
  statementFiles: StatementFileInput[],
  historyRecords: HistoryRecordInput[],
  syncLogs: SyncLogInput[],
  maxRuns: number,
): DashboardData["drive"] {
  const extratos = { total: 0, ofx: 0, pdf: 0, comCopiaDrive: 0, semCopiaDrive: 0, convertidos: 0, ultimaCaptura: null as string | null };
  const envioCrm = { enviado: 0, erro: 0, nao_enviar: 0, pendente: 0 };
  let lastCapture: number | null = null;
  for (const f of statementFiles) {
    extratos.total++;
    if (f.format === "ofx") extratos.ofx++;
    else if (f.format === "pdf") extratos.pdf++;
    if (f.drive_file_id) extratos.comCopiaDrive++;
    else extratos.semCopiaDrive++;
    if (f.converted_from_id) extratos.convertidos++;
    // "enviando" (envio em andamento) e sem status contam como pendente
    if (f.delivery_status === "enviado") envioCrm.enviado++;
    else if (f.delivery_status === "erro") envioCrm.erro++;
    else if (f.delivery_status === "nao_enviar") envioCrm.nao_enviar++;
    else envioCrm.pendente++;
    const t = time(f.synced_at);
    if (t !== null && (lastCapture === null || t > lastCapture)) {
      lastCapture = t;
      extratos.ultimaCaptura = f.synced_at ?? null;
    }
  }

  const historico = { tarefas: historyRecords.length, comPdfNoDrive: 0, comArquivoNoDrive: 0 };
  for (const h of historyRecords) {
    if (h.drive_pdf_link) historico.comPdfNoDrive++;
    if (h.drive_pdf_link || h.drive_file_link) historico.comArquivoNoDrive++;
  }

  const runs = [...syncLogs]
    .sort((a, b) => (time(b.started_at) ?? -Infinity) - (time(a.started_at) ?? -Infinity))
    .map(toSyncRun);
  return {
    extratos,
    envioCrm,
    historico,
    ultimaSincronizacao: runs[0] ?? null,
    execucoes: runs.slice(0, maxRuns),
  };
}

/** Competência (AAAA-MM) de um instante no fuso de Brasília. */
export function competenceAt(date: Date): string {
  return saoPauloCompetence(date) ?? date.toISOString().slice(0, 7);
}

/** Monta o JSON completo do painel. */
export function buildDashboard(input: DashboardInput, options: DashboardOptions = {}): DashboardData {
  const now = options.now ?? new Date();
  const competencias = clampInt(options.competencias, 6, 1, 36);
  const top = clampInt(options.top, 10, 1, 100);
  const maxRuns = clampInt(options.execucoes, 10, 1, 100);
  const empresa = options.empresa?.trim() || null;
  const responsavel = options.responsavel?.trim() || null;

  const snapshot = currentSnapshot(input.tasks);
  let sincronizadoEm: string | null = null;
  for (const t of snapshot) if (t.synced_at) { sincronizadoEm = t.synced_at; break; }

  const tasks = snapshot.filter(
    (t) =>
      (!empresa || norm(t.company_code) === norm(empresa)) &&
      (!responsavel || norm(t.owner_name) === norm(responsavel)),
  );

  // Itens de documentos: só das tarefas do retrato atual (e dos filtros), quando há retrato
  const taskIds = new Set(tasks.map((t) => t.gestta_task_id));
  const hasSnapshot = input.tasks.length > 0;
  const requests = input.documentRequests.filter(
    (d) =>
      (hasSnapshot ? taskIds.has(d.gestta_task_id) : !responsavel) &&
      (!empresa || norm(d.company_code) === norm(empresa)),
  );

  const statementFiles = empresa
    ? input.statementFiles.filter((f) => norm(f.company_code) === norm(empresa))
    : input.statementFiles;
  const historyRecords = empresa
    ? input.historyRecords.filter((h) => norm(h.company_code) === norm(empresa))
    : input.historyRecords;

  return {
    geradoEm: now.toISOString(),
    filtros: { competencias, empresa, responsavel },
    retrato: { sincronizadoEm, tarefas: snapshot.length },
    kpis: computeKpis(tasks),
    serie: computeSeries(tasks, competencias, competenceAt(now)),
    ranking: computeRankings(tasks, top),
    documentos: computeMissingDocuments(requests, saoPauloDate(now)),
    drive: computeDriveStatus(statementFiles, historyRecords, input.syncLogs, maxRuns),
  };
}

/** Estrutura vazia válida (sem Supabase configurado). */
export function emptyDashboard(options: DashboardOptions = {}): DashboardData {
  return buildDashboard(
    { tasks: [], documentRequests: [], statementFiles: [], historyRecords: [], syncLogs: [] },
    options,
  );
}
