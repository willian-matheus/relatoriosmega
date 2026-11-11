import { getSupabaseServerClient } from "./supabase-server";
import { getStatementContent } from "./statements";
import { parseOfxAccount, parseOfxTransactions, parsePdfStatement } from "./pdf-to-ofx";
import { planDeliveries, type DeliveryDecision, type LocalStatement } from "./delivery/dedupe";
import {
  loadDestinationIndex,
  normalizeName,
  type DestinationIndex,
  type LocalCompanyRef,
} from "./delivery/destination";

/**
 * Envio dos extratos capturados para a plataforma de destino (CRM-MEGA).
 *
 * O destino recebe em POST {EXTRATOS_DESTINO_URL}/api/extratos (multipart: arquivo +
 * CNPJ, código e nome da empresa, competência) com "Authorization: Bearer <token>".
 * Ele NÃO evita duplicidade, então este módulo garante, antes de cada envio, que o
 * extrato não chega duas vezes (ver delivery/dedupe.ts):
 *  - arquivo idêntico enviado mais de uma vez pelo cliente;
 *  - OFX e PDF do mesmo extrato (vai só um: OFX do cliente > OFX convertido > PDF);
 *  - extrato que o destino já tem (consultado no banco dele, somente leitura);
 *  - extrato já enviado antes.
 * Só vão extratos de conta corrente. Cada arquivo é enviado uma única vez.
 */

const CHECKING_ACCOUNT_DOC = /conta\s+corrente/i;
export const MAX_ATTEMPTS = 3;
const SEND_TIMEOUT_MS = 60_000;
/** Grupos (empresa + competência) analisados por lote */
export const GROUP_BATCH = 25;
/** Arquivos lidos ao mesmo tempo para calcular a impressão digital */
const FINGERPRINT_CONCURRENCY = 6;

export interface DeliveryOptions {
  /** Máximo de arquivos enviados nesta execução (padrão 20) */
  limit?: number;
  /** Restringe os candidatos a estes extratos (ids do relatoriosmega) */
  ids?: string[];
  /**
   * Só calcula o que seria enviado: não envia nem altera o status de nenhum arquivo.
   * (Pode guardar a impressão digital dos arquivos, que é só um cache do conteúdo.)
   */
  dryRun?: boolean;
}

export type DeliveryResult = "enviado" | "erro" | "nao_enviar" | "planejado" | "aguardando";

export interface DeliveryItemResult {
  id: string;
  fileName: string;
  company: string;
  competence: string | null;
  format: string;
  result: DeliveryResult;
  detail: string;
}

export interface DeliverySummary {
  destination: string;
  dryRun: boolean;
  sent: number;
  failed: number;
  skipped: number;
  waiting: number;
  items: DeliveryItemResult[];
}

/** Linha de extrato como guardada no relatoriosmega. */
export interface DeliveryRow {
  id: string;
  gestta_task_id: string;
  company_name: string;
  company_code: string | null;
  company_cnpj: string | null;
  competence: string | null;
  document_type: string | null;
  format: "ofx" | "pdf";
  file_name: string;
  sha256: string;
  uploaded_at: string | null;
  converted_from_id: string | null;
  delivery_status: string | null;
  delivery_attempts: number;
  /** cache da conta e dos lançamentos (ver StoredFingerprint) */
  fingerprint?: unknown;
}

/** Acesso aos extratos do relatoriosmega (substituível nos testes). */
export interface DeliveryStore {
  listPending(ids?: string[]): Promise<DeliveryRow[]>;
  listGroupRows(companyCodes: string[], companyNames: string[], competences: string[]): Promise<DeliveryRow[]>;
  getContent(id: string): Promise<Buffer | null>;
  markSkipped(id: string, reason: string): Promise<void>;
  /** Reserva o arquivo para envio; false se outra execução já reservou/enviou. */
  claim(id: string, attempts: number): Promise<boolean>;
  markResult(id: string, ok: boolean, detail: string): Promise<void>;
  /** Guarda a impressão digital calculada (cache) */
  saveFingerprint(id: string, fp: StoredFingerprint): Promise<void>;
}

export interface SendPayload {
  fileName: string;
  contentType: string;
  buffer: Buffer;
  cnpj: string | null;
  companyCode: string | null;
  companyName: string;
  competence: string | null;
}

export type Sender = (payload: SendPayload) => Promise<{ status: number; body: any; text: string }>;

export interface DeliveryDeps {
  store: DeliveryStore;
  loadDestination: (companies: LocalCompanyRef[], competences: string[]) => Promise<DestinationIndex>;
  send: Sender;
  destinationLabel: string;
}

// ------------------------------------------------------------------ identidade da empresa

export function companyKeyOf(row: Pick<DeliveryRow, "company_code" | "company_cnpj" | "company_name">): string {
  if (row.company_code) return `cod:${row.company_code}`;
  const cnpj = (row.company_cnpj || "").replace(/\D/g, "");
  if (cnpj) return `doc:${cnpj}`;
  return `nome:${normalizeName(row.company_name)}`;
}

const isChecking = (r: DeliveryRow) => CHECKING_ACCOUNT_DOC.test(r.document_type || "");

// ------------------------------------------------------------------ leitura do arquivo

/** Versão do formato da impressão digital guardada (mudou a leitura? incremente). */
export const FINGERPRINT_VERSION = 1;

/** Impressão digital guardada no banco: conta e lançamentos em [data, centavos]. */
export interface StoredFingerprint {
  v: number;
  account: { bankCode?: string | null; number?: string | null } | null;
  transactions: [string, number][] | null;
}

/** Lê a conta e os lançamentos do arquivo (quando legíveis). */
export async function computeFingerprint(row: DeliveryRow, buffer: Buffer | null): Promise<StoredFingerprint> {
  const fp: StoredFingerprint = { v: FINGERPRINT_VERSION, account: null, transactions: null };
  if (!buffer) return fp;
  try {
    if (row.format === "ofx") {
      const acct = parseOfxAccount(buffer);
      fp.account = { bankCode: acct.bankCode ?? null, number: acct.number ?? null };
      fp.transactions = parseOfxTransactions(buffer).map((t) => [t.date, Math.round(t.amount * 100)]);
    } else {
      const parsed = await parsePdfStatement(buffer, { fileName: row.file_name });
      fp.account = { bankCode: parsed.account.bankId ?? null, number: parsed.account.accountId ?? null };
      // Só confia nos lançamentos do PDF quando conferiram com os saldos
      fp.transactions = parsed.ok ? parsed.transactions.map((t) => [t.date, Math.round(t.amount * 100)]) : null;
    }
  } catch {
    fp.transactions = null;
  }
  return fp;
}

/** Impressão digital guardada e válida (versão atual), ou null para recalcular. */
export function readStoredFingerprint(row: DeliveryRow): StoredFingerprint | null {
  const fp = row.fingerprint as StoredFingerprint | null | undefined;
  if (!fp || typeof fp !== "object" || fp.v !== FINGERPRINT_VERSION) return null;
  if (fp.transactions !== null && !Array.isArray(fp.transactions)) return null;
  return fp;
}

export function toLocal(row: DeliveryRow, fp: StoredFingerprint, alreadySent: boolean): LocalStatement {
  return {
    id: row.id,
    companyKey: companyKeyOf(row),
    competence: row.competence,
    format: row.format,
    converted: Boolean(row.converted_from_id),
    sha256: row.sha256,
    fileName: row.file_name,
    uploadedAt: row.uploaded_at,
    account: fp.account,
    transactions: fp.transactions ? fp.transactions.map(([date, cents]) => ({ date, amount: cents / 100 })) : null,
    alreadySent,
  };
}

/** map com no máximo `limit` tarefas simultâneas, preservando a ordem. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ------------------------------------------------------------------ orquestração

export async function deliverStatements(
  options: DeliveryOptions = {},
  deps: DeliveryDeps = defaultDeps(),
): Promise<DeliverySummary> {
  const limit = Math.max(0, options.limit ?? 20);
  const dryRun = Boolean(options.dryRun);
  const summary: DeliverySummary = {
    destination: deps.destinationLabel,
    dryRun,
    sent: 0,
    failed: 0,
    skipped: 0,
    waiting: 0,
    items: [],
  };

  // 1. Candidatos: conta corrente, ainda não enviados ou com erro e tentativas restantes
  const pending = (await deps.store.listPending(options.ids)).filter(
    (r) =>
      isChecking(r) &&
      (r.delivery_status === null || (r.delivery_status === "erro" && r.delivery_attempts < MAX_ATTEMPTS)),
  );
  if (!pending.length) return summary;

  const item = (r: DeliveryRow, result: DeliveryResult, detail: string): DeliveryItemResult => ({
    id: r.id,
    fileName: r.file_name,
    company: r.company_name,
    competence: r.competence,
    format: r.format,
    result,
    detail,
  });

  // 2. Grupos empresa + competência, na ordem dos candidatos (mais antigos primeiro)
  const groupOrder: string[] = [];
  const pendingByGroup = new Map<string, DeliveryRow[]>();
  for (const r of pending) {
    const key = `${companyKeyOf(r)}|${r.competence}`;
    if (!pendingByGroup.has(key)) {
      pendingByGroup.set(key, []);
      groupOrder.push(key);
    }
    pendingByGroup.get(key)!.push(r);
  }

  // 3. Processa em lotes de grupos: o trabalho por execução fica limitado e para
  //    assim que o limite de envios é atingido.
  for (let start = 0; start < groupOrder.length; start += GROUP_BATCH) {
    if (!dryRun && summary.sent + summary.failed >= limit) {
      // o restante fica para a próxima execução
      for (const key of groupOrder.slice(start)) {
        for (const r of pendingByGroup.get(key)!) {
          summary.waiting++;
          summary.items.push(item(r, "aguardando", "fora do limite desta execução; vai na próxima"));
        }
      }
      break;
    }
    const batchKeys = groupOrder.slice(start, start + GROUP_BATCH);
    const batchPending = batchKeys.flatMap((k) => pendingByGroup.get(k)!);
    await processBatch(batchKeys, batchPending);
  }

  return summary;

  async function processBatch(batchKeys: string[], batchPending: DeliveryRow[]): Promise<void> {
    // Todos os arquivos dos grupos (inclusive já enviados), para comparar
    const keys = new Set(batchKeys);
    const codes = [...new Set(batchPending.map((r) => r.company_code).filter((c): c is string => Boolean(c)))];
    const names = [...new Set(batchPending.filter((r) => !r.company_code).map((r) => r.company_name))];
    const competences = [...new Set(batchPending.map((r) => r.competence).filter((c): c is string => Boolean(c)))];
    const related = (await deps.store.listGroupRows(codes, names, competences)).filter(
      (r) => isChecking(r) && keys.has(`${companyKeyOf(r)}|${r.competence}`),
    );
    const rowsById = new Map<string, DeliveryRow>();
    for (const r of [...related, ...batchPending]) rowsById.set(r.id, r);

    // Já enviados (ou em envio) são referência; "nao_enviar" foram descartados e não entram
    const pendingIds = new Set(batchPending.map((r) => r.id));
    const considered = [...rowsById.values()].filter(
      (r) => pendingIds.has(r.id) || r.delivery_status === "enviado" || r.delivery_status === "enviando",
    );

    // Impressões digitais: reaproveita a guardada; calcula (em paralelo) só as que faltam
    const locals: LocalStatement[] = await mapLimit(considered, FINGERPRINT_CONCURRENCY, async (r) => {
      const stored = readStoredFingerprint(r);
      if (stored) return toLocal(r, stored, !pendingIds.has(r.id));
      const buffer = await deps.store.getContent(r.id);
      const fp = await computeFingerprint(r, buffer);
      // Cache derivado do arquivo (não altera o status de envio); só guarda se o arquivo foi lido
      if (buffer) await deps.store.saveFingerprint(r.id, fp).catch(() => undefined);
      return toLocal(r, fp, !pendingIds.has(r.id));
    });

    // O que o destino já tem
    const companies: LocalCompanyRef[] = [];
    const seen = new Set<string>();
    for (const r of considered) {
      const key = companyKeyOf(r);
      if (seen.has(key)) continue;
      seen.add(key);
      companies.push({ companyKey: key, code: r.company_code, name: r.company_name, cnpj: r.company_cnpj });
    }
    const destination = await deps.loadDestination(companies, competences);

    // Plano e aplicação (na ordem dos candidatos)
    const decisions: DeliveryDecision[] = planDeliveries(locals, destination.statements, destination.competenceOf);
    const decisionById = new Map(decisions.map((d) => [d.id, d]));
    const toSend: DeliveryRow[] = [];
    for (const r of batchPending) {
      const d = decisionById.get(r.id);
      if (!d) continue;
      if (d.action === "skip") {
        summary.skipped++;
        summary.items.push(item(r, "nao_enviar", d.reason));
        if (!dryRun) await deps.store.markSkipped(r.id, d.reason);
        continue;
      }
      // Empresa que o destino não reconhece: o envio seria recusado. Fica aguardando
      // (sem marcar nada) até a empresa existir lá.
      if (!destination.companies.get(companyKeyOf(r))) {
        summary.waiting++;
        summary.items.push(item(r, "aguardando", "empresa não encontrada no destino; envio adiado até o cadastro dela lá"));
        continue;
      }
      toSend.push(r);
    }

    for (const r of toSend) {
      if (summary.sent + summary.failed >= limit) {
        summary.items.push(item(r, dryRun ? "planejado" : "aguardando", "fora do limite desta execução; vai na próxima"));
        if (!dryRun) summary.waiting++;
        continue;
      }
      if (dryRun) {
        summary.items.push(item(r, "planejado", "seria enviado"));
        continue;
      }
      if (!(await deps.store.claim(r.id, r.delivery_attempts + 1))) continue;

      let status = 0;
      let detail = "";
      try {
        const buffer = await deps.store.getContent(r.id);
        if (!buffer) throw new Error("arquivo não encontrado no armazenamento");
        const res = await deps.send({
          fileName: r.file_name,
          contentType: r.format === "ofx" ? "application/x-ofx" : "application/pdf",
          buffer,
          cnpj: r.company_cnpj,
          companyCode: r.company_code,
          companyName: r.company_name,
          competence: r.competence,
        });
        status = res.status;
        detail = summarizeResponse(res.status, res.body, res.text);
      } catch (err: any) {
        detail = `falha de comunicação: ${err?.message || err}`;
      }
      const ok = status === 201;
      await deps.store.markResult(r.id, ok, detail);
      if (ok) summary.sent++;
      else summary.failed++;
      summary.items.push(item(r, ok ? "enviado" : "erro", detail));
    }
  }
  return summary;
}

export function summarizeResponse(status: number, body: any, text: string): string {
  if (status === 201 && body) {
    const s = body.summary || {};
    return [
      `extrato ${body.statementId || "?"}`,
      body.competence ? `competência ${body.competence}` : "",
      s.transactionsCreated !== undefined ? `${s.transactionsCreated} lançamentos` : "",
      body.identificacao?.confirmedBy?.length ? `empresa confirmada por: ${body.identificacao.confirmedBy.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  }
  const msg = body?.error || text || "sem resposta";
  return `HTTP ${status}: ${String(msg).slice(0, 500)}${body?.motivo ? ` (${body.motivo})` : ""}`;
}

// ------------------------------------------------------------------ implementações reais

export function getDeliveryConfig(): { url: string; token: string } {
  const url = (process.env.EXTRATOS_DESTINO_URL || "").replace(/\/+$/, "");
  const token = (process.env.EXTRATOS_DESTINO_TOKEN || "").trim();
  if (!url || !token) {
    throw new Error(
      "Configure EXTRATOS_DESTINO_URL (endereço da plataforma de destino) e EXTRATOS_DESTINO_TOKEN no ambiente.",
    );
  }
  return { url, token };
}

const COLUMNS =
  "id, gestta_task_id, company_name, company_code, company_cnpj, competence, document_type, format, file_name, sha256, uploaded_at, converted_from_id, delivery_status, delivery_attempts, fingerprint";

export function supabaseDeliveryStore(): DeliveryStore {
  const db = () => getSupabaseServerClient() as any;
  const now = () => new Date().toISOString();
  return {
    async listPending(ids) {
      let q = db()
        .from("gestta_statement_files")
        .select(COLUMNS)
        .or(`delivery_status.is.null,and(delivery_status.eq.erro,delivery_attempts.lt.${MAX_ATTEMPTS})`)
        .order("synced_at", { ascending: true })
        .limit(2000);
      if (ids?.length) q = q.in("id", ids);
      const { data, error } = await q;
      if (error) throw new Error(`Falha ao listar extratos para envio: ${error.message}`);
      return data as DeliveryRow[];
    },
    async listGroupRows(codes, names, competences) {
      const out: DeliveryRow[] = [];
      if (!competences.length) return out;
      if (codes.length) {
        const { data, error } = await db().from("gestta_statement_files").select(COLUMNS)
          .in("company_code", codes).in("competence", competences);
        if (error) throw new Error(`Falha ao carregar arquivos relacionados: ${error.message}`);
        out.push(...(data as DeliveryRow[]));
      }
      if (names.length) {
        const { data, error } = await db().from("gestta_statement_files").select(COLUMNS)
          .is("company_code", null).in("company_name", names).in("competence", competences);
        if (error) throw new Error(`Falha ao carregar arquivos relacionados: ${error.message}`);
        out.push(...(data as DeliveryRow[]));
      }
      return out;
    },
    async getContent(id) {
      return (await getStatementContent(id))?.buffer ?? null;
    },
    async markSkipped(id, reason) {
      await db().from("gestta_statement_files")
        .update({ delivery_status: "nao_enviar", delivery_response: reason, delivery_updated_at: now() })
        .eq("id", id)
        .or("delivery_status.is.null,delivery_status.eq.erro");
    },
    async claim(id, attempts) {
      const { data } = await db().from("gestta_statement_files")
        .update({ delivery_status: "enviando", delivery_attempts: attempts, delivery_updated_at: now() })
        .eq("id", id)
        .or("delivery_status.is.null,delivery_status.eq.erro")
        .select("id");
      return Boolean(data?.length);
    },
    async saveFingerprint(id, fp) {
      await db().from("gestta_statement_files").update({ fingerprint: fp }).eq("id", id);
    },
    async markResult(id, ok, detail) {
      await db().from("gestta_statement_files")
        .update({
          delivery_status: ok ? "enviado" : "erro",
          delivered_at: ok ? now() : null,
          delivery_response: detail,
          delivery_updated_at: now(),
        })
        .eq("id", id);
    },
  };
}

export function httpSender(url: string, token: string): Sender {
  return async (p) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(p.buffer)], { type: p.contentType }), p.fileName);
    if (p.cnpj) form.append("cnpj", p.cnpj);
    if (p.companyCode) form.append("empresaCodigo", p.companyCode);
    form.append("empresaNome", p.companyName);
    if (p.competence) form.append("competence", p.competence);
    const res = await fetch(`${url}/api/extratos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      // resposta não JSON
    }
    return { status: res.status, body, text };
  };
}

function defaultDeps(): DeliveryDeps {
  const { url, token } = getDeliveryConfig();
  return {
    store: supabaseDeliveryStore(),
    loadDestination: loadDestinationIndex,
    send: httpSender(url, token),
    destinationLabel: url,
  };
}
