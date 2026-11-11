import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  deliverStatements,
  FINGERPRINT_VERSION,
  GROUP_BATCH,
  mapLimit,
  MAX_ATTEMPTS,
  type StoredFingerprint,
  summarizeResponse,
  type DeliveryDeps,
  type DeliveryRow,
  type DeliveryStore,
  type SendPayload,
} from "../src/lib/statement-delivery";
import { buildOfx, parseOfxAccount, parseOfxTransactions, type PdfStatementResult } from "../src/lib/pdf-to-ofx";
import type { DestinationStatement } from "../src/lib/delivery/dedupe";
import { destinationCompetences, type DestinationIndex } from "../src/lib/delivery/destination";

// ------------------------------------------------------------------ dados de teste

type Tx = { date: string; amount: number; description: string };
const SEPT: Tx[] = [
  { date: "2026-09-01", amount: 1500, description: "PIX RECEBIDO" },
  { date: "2026-09-03", amount: -320.45, description: "BOLETO" },
  { date: "2026-09-10", amount: 2000, description: "TED" },
  { date: "2026-09-30", amount: -15.7, description: "TARIFA" },
];

function makeOfx(bankId: string, accountId: string, txs: Tx[], tag = "x"): Buffer {
  const result: PdfStatementResult = {
    ok: true,
    transactions: txs,
    checkpoints: { passed: 1, failed: 0, details: [] },
    openingBalance: 0,
    closingBalance: txs.reduce((s, t) => s + t.amount, 0),
    period: { start: "2026-09-01", end: "2026-09-30" },
    account: { bankId, accountId },
  };
  return buildOfx(result, { fitIdPrefix: tag });
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ------------------------------------------------------------------ armazenamento falso (imita o banco)

class FakeStore implements DeliveryStore {
  rows = new Map<string, DeliveryRow & { delivery_response?: string | null; delivered_at?: string | null }>();
  files = new Map<string, Buffer>();
  claimCalls: string[] = [];
  contentCalls: string[] = [];
  groupQueries = 0;
  /** simula outra execução reservando o arquivo antes desta */
  stolenClaims = new Set<string>();

  add(p: Partial<DeliveryRow> & { id: string; buffer: Buffer }): void {
    const { buffer, ...rest } = p;
    this.files.set(p.id, buffer);
    this.rows.set(p.id, {
      gestta_task_id: "T1",
      company_name: "EMPRESA TESTE LTDA",
      company_code: "100",
      company_cnpj: "12345678000190",
      competence: "2026-09",
      document_type: "Extratos de Conta Corrente ( em .OFX e em .PDF)",
      format: "ofx",
      file_name: `${p.id}.${p.format || "ofx"}`,
      sha256: sha(buffer),
      uploaded_at: "2026-10-02T10:00:00Z",
      converted_from_id: null,
      delivery_status: null,
      delivery_attempts: 0,
      ...rest,
    } as DeliveryRow);
  }

  status(id: string) {
    return this.rows.get(id)!.delivery_status;
  }

  async listPending(ids?: string[]) {
    return [...this.rows.values()]
      .filter((r) => r.delivery_status === null || (r.delivery_status === "erro" && r.delivery_attempts < MAX_ATTEMPTS))
      .filter((r) => !ids || ids.includes(r.id))
      .map((r) => ({ ...r }));
  }
  async listGroupRows(codes: string[], names: string[], competences: string[]) {
    this.groupQueries++;
    return [...this.rows.values()]
      .filter((r) => competences.includes(r.competence || "") && ((r.company_code && codes.includes(r.company_code)) || (!r.company_code && names.includes(r.company_name))))
      .map((r) => ({ ...r }));
  }
  async getContent(id: string) {
    this.contentCalls.push(id);
    return this.files.get(id) ?? null;
  }
  async saveFingerprint(id: string, fp: StoredFingerprint) {
    this.rows.get(id)!.fingerprint = fp;
  }
  async markSkipped(id: string, reason: string) {
    const r = this.rows.get(id)!;
    if (r.delivery_status === null || r.delivery_status === "erro") {
      r.delivery_status = "nao_enviar";
      r.delivery_response = reason;
    }
  }
  async claim(id: string, attempts: number) {
    this.claimCalls.push(id);
    const r = this.rows.get(id)!;
    if (this.stolenClaims.has(id)) {
      r.delivery_status = "enviando";
      return false;
    }
    if (r.delivery_status !== null && r.delivery_status !== "erro") return false;
    r.delivery_status = "enviando";
    r.delivery_attempts = attempts;
    return true;
  }
  async markResult(id: string, ok: boolean, detail: string) {
    const r = this.rows.get(id)!;
    r.delivery_status = ok ? "enviado" : "erro";
    r.delivered_at = ok ? "agora" : null;
    r.delivery_response = detail;
  }
}

// ------------------------------------------------------------------ destino falso

class FakeDestination {
  companies = new Map<string, string | null>([["cod:100", "DEST-100"], ["cod:200", "DEST-200"]]);
  statements: DestinationStatement[] = [];
  received: SendPayload[] = [];
  /** respostas forçadas por nome de arquivo */
  failures = new Map<string, { status: number; body: any } | "network">();
  /** quando true, aceita o envio mas "perde" a resposta (simula timeout depois de gravar) */
  loseResponseFor = new Set<string>();

  load = async (refs: { companyKey: string }[], _competences?: string[]): Promise<DestinationIndex> => ({
    companies: new Map(refs.map((r) => [r.companyKey, this.companies.get(r.companyKey) ?? null])),
    statements: this.statements.filter((s) => refs.some((r) => r.companyKey === s.companyKey)),
    competenceOf: destinationCompetences,
  });

  send = async (p: SendPayload) => {
    const f = this.failures.get(p.fileName);
    if (f === "network") throw new Error("ECONNREFUSED");
    if (f) return { status: f.status, body: f.body, text: JSON.stringify(f.body) };
    this.received.push(p);
    // o destino passa a ter o extrato
    const acct = parseOfxAccount(p.buffer);
    this.statements.push({
      id: `D-${this.received.length}`,
      name: `${p.fileName} — 09/2026`,
      companyKey: `cod:${p.companyCode}`,
      account: { bankCode: acct.bankCode, number: acct.number },
      transactions: p.fileName.endsWith(".ofx") ? parseOfxTransactions(p.buffer).map((t) => ({ date: t.date, amount: t.amount })) : [],
    });
    if (this.loseResponseFor.has(p.fileName)) throw new Error("timeout");
    return {
      status: 201,
      body: { statementId: `D-${this.received.length}`, competence: p.competence, summary: { transactionsCreated: 4 }, identificacao: { confirmedBy: ["código SCI"] } },
      text: "",
    };
  };
}

let store: FakeStore;
let destination: FakeDestination;
let deps: DeliveryDeps;

beforeEach(() => {
  store = new FakeStore();
  destination = new FakeDestination();
  deps = { store, loadDestination: destination.load, send: destination.send, destinationLabel: "destino-de-teste" };
});

// ------------------------------------------------------------------ cenários

describe("fluxo de envio", () => {
  test("envia o OFX e não envia o PDF do mesmo extrato; o destino recebe uma única vez", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345-6", SEPT) });
    store.add({ id: "pdf", format: "pdf", buffer: Buffer.from("%PDF-1.4 conteudo ilegivel") });

    const r = await deliverStatements({}, deps);

    assert.equal(r.sent, 1);
    assert.equal(r.skipped, 1);
    assert.equal(destination.received.length, 1);
    assert.equal(destination.received[0].fileName, "ofx.ofx");
    assert.equal(store.status("ofx"), "enviado");
    assert.equal(store.status("pdf"), "nao_enviar");
  });

  test("envia os dados de identificação da empresa", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    await deliverStatements({}, deps);
    const p = destination.received[0];
    assert.equal(p.cnpj, "12345678000190");
    assert.equal(p.companyCode, "100");
    assert.equal(p.companyName, "EMPRESA TESTE LTDA");
    assert.equal(p.competence, "2026-09");
    assert.equal(p.contentType, "application/x-ofx");
  });

  test("segunda execução não reenvia nada (idempotente)", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    await deliverStatements({}, deps);
    const again = await deliverStatements({}, deps);
    assert.equal(again.sent, 0);
    assert.equal(destination.received.length, 1);
  });

  test("não envia o que o destino já tem (ex.: veio pelo SCI Web)", async () => {
    destination.statements.push({
      id: "SCI-1",
      name: "Itaú (Conta 123456) — 09/2026",
      companyKey: "cod:100",
      account: { bankCode: "341", number: "123456" },
      transactions: SEPT.map((t) => ({ date: t.date, amount: t.amount })),
    });
    store.add({ id: "ofx", buffer: makeOfx("341", "12345-6", SEPT) });

    const r = await deliverStatements({}, deps);

    assert.equal(r.sent, 0);
    assert.equal(destination.received.length, 0);
    assert.equal(store.status("ofx"), "nao_enviar");
    assert.match(r.items[0].detail, /destino já tem/);
  });

  test("simulação (dryRun) não envia nem grava nada", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    store.add({ id: "pdf", format: "pdf", buffer: Buffer.from("%PDF") });

    const r = await deliverStatements({ dryRun: true }, deps);

    assert.equal(r.dryRun, true);
    assert.equal(destination.received.length, 0);
    assert.equal(store.claimCalls.length, 0);
    assert.equal(store.status("ofx"), null);
    assert.equal(store.status("pdf"), null);
    assert.deepEqual(r.items.map((i) => i.result).sort(), ["nao_enviar", "planejado"]);
  });

  test("respeita o limite por execução e envia o restante na próxima", async () => {
    for (let i = 0; i < 5; i++) {
      store.add({ id: `e${i}`, company_code: `${300 + i}`, buffer: makeOfx("341", `${90000 + i}`, SEPT, `t${i}`) });
      destination.companies.set(`cod:${300 + i}`, `DEST-${i}`);
    }
    const first = await deliverStatements({ limit: 2 }, deps);
    assert.equal(first.sent, 2);
    assert.equal(first.waiting, 3);
    const second = await deliverStatements({ limit: 10 }, deps);
    assert.equal(second.sent, 3);
    assert.equal(destination.received.length, 5);
  });

  test("erro do destino: registra, tenta de novo e para após o máximo de tentativas", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    destination.failures.set("ofx.ofx", { status: 500, body: { error: "Erro interno" } });

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const r = await deliverStatements({}, deps);
      assert.equal(r.failed, 1, `tentativa ${i}`);
      assert.equal(store.rows.get("ofx")!.delivery_attempts, i);
    }
    const after = await deliverStatements({}, deps);
    assert.equal(after.failed, 0, "não tenta além do máximo");
    assert.equal(store.status("ofx"), "erro");
    assert.match(store.rows.get("ofx")!.delivery_response!, /HTTP 500/);
  });

  test("o limite de tentativas vale mesmo se a consulta ao banco devolver arquivos esgotados", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT), delivery_status: "erro", delivery_attempts: MAX_ATTEMPTS });
    // armazenamento "descuidado": devolve tudo, sem filtrar tentativas
    const leaky = Object.assign(Object.create(store), {
      listPending: async () => [...store.rows.values()].map((r) => ({ ...r })),
    });
    const r = await deliverStatements({}, { ...deps, store: leaky });
    assert.equal(r.items.length, 0);
    assert.equal(destination.received.length, 0);
    assert.equal(store.claimCalls.length, 0);
  });

  test("falha de rede é tratada como erro (não quebra a execução)", async () => {
    store.add({ id: "a", company_code: "100", buffer: makeOfx("341", "11111", SEPT, "a") });
    store.add({ id: "b", company_code: "200", buffer: makeOfx("341", "22222", SEPT, "b") });
    destination.failures.set("a.ofx", "network");

    const r = await deliverStatements({}, deps);

    assert.equal(r.failed, 1);
    assert.equal(r.sent, 1, "o outro arquivo continua sendo enviado");
    assert.match(store.rows.get("a")!.delivery_response!, /falha de comunicação/);
  });

  test("resposta perdida depois de o destino gravar: a nova tentativa detecta e NÃO duplica", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    destination.loseResponseFor.add("ofx.ofx");

    const first = await deliverStatements({}, deps);
    assert.equal(first.failed, 1);
    assert.equal(destination.received.length, 1, "o destino gravou");

    destination.loseResponseFor.clear();
    const retry = await deliverStatements({}, deps);
    assert.equal(retry.sent, 0);
    assert.equal(destination.received.length, 1, "não duplicou no destino");
    assert.equal(store.status("ofx"), "nao_enviar");
  });

  test("empresa que o destino não reconhece fica aguardando, sem marcar nada", async () => {
    store.add({ id: "x", company_code: "999", buffer: makeOfx("341", "12345", SEPT) });
    const r = await deliverStatements({}, deps);
    assert.equal(r.waiting, 1);
    assert.equal(destination.received.length, 0);
    assert.equal(store.status("x"), null, "continua pendente para quando a empresa existir lá");

    destination.companies.set("cod:999", "DEST-999");
    const later = await deliverStatements({}, deps);
    assert.equal(later.sent, 1);
  });

  test("outra execução reservou o arquivo antes: esta não envia", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    store.stolenClaims.add("ofx");
    const r = await deliverStatements({}, deps);
    assert.equal(r.sent, 0);
    assert.equal(destination.received.length, 0);
  });

  test("execuções simultâneas não enviam o mesmo arquivo duas vezes", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    await Promise.all([deliverStatements({}, deps), deliverStatements({}, deps), deliverStatements({}, deps)]);
    assert.equal(destination.received.length, 1);
  });

  test("ignora extratos que não são de conta corrente", async () => {
    store.add({ id: "aplic", document_type: "Extratos de Aplicações Financeiras (em .PDF)", format: "pdf", buffer: Buffer.from("%PDF") });
    store.add({ id: "cotas", document_type: "Extratos de Cotas de Capital", buffer: makeOfx("085", "1", SEPT) });
    const r = await deliverStatements({}, deps);
    assert.equal(r.items.length, 0);
    assert.equal(destination.received.length, 0);
  });

  test("filtro por ids restringe os candidatos mas compara com todo o grupo", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT), delivery_status: "enviado" });
    store.add({ id: "pdf", format: "pdf", buffer: Buffer.from("%PDF") });
    const r = await deliverStatements({ ids: ["pdf"] }, deps);
    assert.equal(r.sent, 0);
    assert.equal(store.status("pdf"), "nao_enviar", "o OFX já enviado do grupo bloqueia o PDF");
  });

  test("arquivo descartado (nao_enviar) não volta a ser avaliado", async () => {
    store.add({ id: "pdf", format: "pdf", buffer: Buffer.from("%PDF"), delivery_status: "nao_enviar" });
    const r = await deliverStatements({}, deps);
    assert.equal(r.items.length, 0);
  });

  test("sem candidatos: não consulta o destino", async () => {
    let loaded = false;
    const r = await deliverStatements({}, { ...deps, loadDestination: async (...a) => { loaded = true; return destination.load(...a); } });
    assert.equal(r.items.length, 0);
    assert.equal(loaded, false);
  });

  test("falha ao consultar o destino interrompe o envio (não envia sem verificar)", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    await assert.rejects(
      deliverStatements({}, { ...deps, loadDestination: async () => { throw new Error("sem acesso ao destino"); } }),
      /sem acesso ao destino/,
    );
    assert.equal(destination.received.length, 0);
    assert.equal(store.status("ofx"), null);
  });
});

describe("desempenho e cache", () => {
  test("a impressão digital é guardada e a execução seguinte não baixa o arquivo de novo", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    store.add({ id: "pdf", format: "pdf", buffer: Buffer.from("%PDF") });
    await deliverStatements({ dryRun: true }, deps);
    assert.equal(store.contentCalls.length, 2, "primeira execução lê os dois arquivos");
    assert.equal((store.rows.get("ofx")!.fingerprint as StoredFingerprint).v, FINGERPRINT_VERSION);

    store.contentCalls = [];
    await deliverStatements({ dryRun: true }, deps);
    assert.equal(store.contentCalls.length, 0, "segunda execução usa o cache");
  });

  test("o cache guarda os lançamentos em centavos, sem erro de arredondamento", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", [{ date: "2026-09-01", amount: 0.1 + 0.2, description: "x" }]) });
    await deliverStatements({ dryRun: true }, deps);
    assert.deepEqual((store.rows.get("ofx")!.fingerprint as StoredFingerprint).transactions, [["2026-09-01", 30]]);
  });

  test("cache de versão antiga ou corrompido é recalculado", async () => {
    store.add({ id: "a", buffer: makeOfx("341", "12345", SEPT), fingerprint: { v: 0, account: null, transactions: [] } } as any);
    store.add({ id: "b", company_code: "200", buffer: makeOfx("341", "6789", SEPT, "b"), fingerprint: { v: FINGERPRINT_VERSION, account: null, transactions: "lixo" } } as any);
    await deliverStatements({ dryRun: true }, deps);
    assert.deepEqual(store.contentCalls.sort(), ["a", "b"]);
  });

  test("o cache é usado na deduplicação (resultado igual ao da leitura do arquivo)", async () => {
    store.add({ id: "ofx", buffer: makeOfx("341", "12345", SEPT) });
    store.add({ id: "ofx2", buffer: makeOfx("341", "12345-6", SEPT, "outro") }); // conteúdo diferente, mesmo extrato
    await deliverStatements({ dryRun: true }, deps); // grava o cache
    const real = await deliverStatements({}, deps); // decide pelo cache
    assert.equal(real.sent, 1);
    assert.equal(real.skipped, 1);
    assert.equal(destination.received.length, 1);
  });

  test("com limite atingido, os grupos restantes nem são analisados (trabalho limitado)", async () => {
    const groups = GROUP_BATCH * 3;
    for (let i = 0; i < groups; i++) {
      store.add({ id: `g${i}`, company_code: `${1000 + i}`, buffer: makeOfx("341", `${50000 + i}`, SEPT, `g${i}`) });
      destination.companies.set(`cod:${1000 + i}`, `DEST-${i}`);
    }
    const r = await deliverStatements({ limit: 3 }, deps);
    assert.equal(r.sent, 3);
    assert.equal(store.groupQueries, 1, "só o primeiro lote foi consultado");
    assert.ok(store.contentCalls.length <= GROUP_BATCH + 3, `leu ${store.contentCalls.length} arquivos`);
    assert.equal(r.waiting, groups - 3);
    assert.equal(r.items.length, groups, "todo candidato aparece no resumo");
  });

  test("a simulação analisa todos os lotes", async () => {
    const groups = GROUP_BATCH + 5;
    for (let i = 0; i < groups; i++) {
      store.add({ id: `g${i}`, company_code: `${2000 + i}`, buffer: makeOfx("341", `${60000 + i}`, SEPT, `g${i}`) });
      destination.companies.set(`cod:${2000 + i}`, `DEST-${i}`);
    }
    const r = await deliverStatements({ dryRun: true, limit: 1000 }, deps);
    assert.equal(store.groupQueries, 2);
    assert.equal(r.items.filter((i) => i.result === "planejado").length, groups);
  });

  test("mapLimit preserva a ordem e respeita o máximo de tarefas simultâneas", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    assert.deepEqual(out, [50, 10, 40, 20, 30, 0, 60]);
    assert.ok(peak <= 3, `pico de ${peak}`);
    assert.deepEqual(await mapLimit([], 3, async (n: number) => n), []);
  });
});

describe("resumo da resposta do destino", () => {
  test("sucesso", () => {
    const s = summarizeResponse(201, { statementId: "abc", competence: "2026-08", summary: { transactionsCreated: 30 }, identificacao: { confirmedBy: ["código SCI", "nome da empresa"] } }, "");
    assert.equal(s, "extrato abc | competência 2026-08 | 30 lançamentos | empresa confirmada por: código SCI, nome da empresa");
  });
  test("erro com motivo", () => {
    assert.equal(summarizeResponse(422, { error: "Empresa não identificada", motivo: "nao_identificado" }, ""), "HTTP 422: Empresa não identificada (nao_identificado)");
  });
  test("erro sem JSON", () => {
    assert.equal(summarizeResponse(502, null, "Bad Gateway"), "HTTP 502: Bad Gateway");
  });
});

describe("OFX gerado (usado nos testes e na conversão)", () => {
  test("ida e volta preserva conta e lançamentos", () => {
    const buf = makeOfx("341", "12345-6", SEPT);
    assert.deepEqual(parseOfxAccount(buf), { bankCode: "341", number: "12345-6" });
    assert.deepEqual(parseOfxTransactions(buf).map((t) => [t.date, t.amount]), SEPT.map((t) => [t.date, t.amount]));
  });
});
