import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboard,
  computeDriveStatus,
  computeKpis,
  computeMissingDocuments,
  computeRankings,
  computeSeries,
  currentSnapshot,
  emptyDashboard,
  lastCompetences,
  type DocumentRequestInput,
  type TaskInput,
} from "../src/lib/dashboard/aggregate";
import { fetchAllPages, loadDashboardInput } from "../src/lib/dashboard/load";

const SYNC = "2026-11-11T13:00:00+00:00";
let seq = 0;
function task(p: Partial<TaskInput> = {}): TaskInput {
  seq++;
  return {
    gestta_task_id: `t${seq}`,
    status: "OPEN",
    overdue: false,
    done_overdue: false,
    competence: "2026-09",
    company_code: "100",
    company_name: "ACME",
    owner_id: "o1",
    owner_name: "Ana",
    synced_at: SYNC,
    ...p,
  };
}
const open = (p: Partial<TaskInput> = {}) => task({ status: "OPEN", overdue: false, ...p });
const late = (p: Partial<TaskInput> = {}) => task({ status: "OPEN", overdue: true, ...p });
const done = (p: Partial<TaskInput> = {}) => task({ status: "DONE", done_overdue: false, ...p });
const doneLate = (p: Partial<TaskInput> = {}) => task({ status: "DONE", done_overdue: true, ...p });
const disc = (p: Partial<TaskInput> = {}) => task({ status: "DISCONSIDERED", ...p });

function req(p: Partial<DocumentRequestInput> = {}): DocumentRequestInput {
  seq++;
  return {
    gestta_task_id: "tx",
    requested_document_id: `r${seq}`,
    task_name: "Envio de Extratos",
    company_code: "100",
    company_name: "ACME",
    competence: "2026-09",
    document_name: "Extratos de Conta Corrente",
    is_statement: true,
    files_count: 0,
    disconsidered: false,
    task_status: "OPEN",
    task_due_date: "2026-10-15",
    ...p,
  };
}

describe("KPIs", () => {
  test("conta cada situação e % concluído no prazo", () => {
    const k = computeKpis([open(), late(), late(), done(), done(), done(), doneLate(), disc()]);
    assert.deepEqual(k, {
      total: 8,
      emAberto: 3,
      atrasadas: 2,
      concluidas: 4,
      concluidasComAtraso: 1,
      desconsideradas: 1,
      percentualNoPrazo: 75,
    });
  });

  test("overdue em tarefa concluída não conta como atrasada; sem concluídas -> null", () => {
    const k = computeKpis([done({ overdue: true }), disc({ overdue: true })]);
    assert.equal(k.atrasadas, 0);
    assert.equal(computeKpis([open()]).percentualNoPrazo, null);
    assert.equal(computeKpis([done(), done(), doneLate()]).percentualNoPrazo, 66.7);
  });
});

describe("série por competência", () => {
  test("últimas N competências em ordem cronológica, inclusive virada de ano", () => {
    assert.deepEqual(lastCompetences("2027-02", 4), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  test("classifica e preenche competências sem dados com zero", () => {
    const serie = computeSeries(
      [
        done({ competence: "2026-09" }),
        doneLate({ competence: "2026-09" }),
        open({ competence: "2026-11" }),
        late({ competence: "2026-11" }),
        late({ competence: "2026-11" }),
        disc({ competence: "2026-11" }),
        late({ competence: "2026-01" }), // fora da janela
        late({ competence: null }),
      ],
      4,
      "2026-11",
    );
    assert.deepEqual(serie.map((p) => p.competencia), ["2026-08", "2026-09", "2026-10", "2026-11"]);
    const zero = { concluidasNoPrazo: 0, concluidasComAtraso: 0, abertasNoPrazo: 0, atrasadas: 0, desconsideradas: 0 };
    assert.deepEqual(serie[0], { competencia: "2026-08", ...zero });
    assert.deepEqual(serie[1], { competencia: "2026-09", ...zero, concluidasNoPrazo: 1, concluidasComAtraso: 1 });
    assert.deepEqual(serie[2], { competencia: "2026-10", ...zero });
    assert.deepEqual(serie[3], { competencia: "2026-11", ...zero, abertasNoPrazo: 1, atrasadas: 2, desconsideradas: 1 });
  });

  test("buildDashboard termina a série na competência atual em Brasília", () => {
    // 01/12 01:00Z ainda é 30/11 em Brasília
    const d = buildDashboard(
      { tasks: [late({ competence: "2026-11" })], documentRequests: [], statementFiles: [], historyRecords: [], syncLogs: [] },
      { competencias: 2, now: new Date("2026-12-01T01:00:00Z") },
    );
    assert.deepEqual(d.serie.map((p) => p.competencia), ["2026-10", "2026-11"]);
    assert.equal(d.serie[1].atrasadas, 1);
  });
});

describe("rankings", () => {
  test("empresas: atrasadas, depois em aberto, depois nome (empates estáveis); top N", () => {
    const tasks = [
      late({ company_code: "1", company_name: "Zeta" }),
      open({ company_code: "1", company_name: "Zeta" }),
      late({ company_code: "2", company_name: "Alfa" }),
      open({ company_code: "2", company_name: "Alfa" }),
      late({ company_code: "3", company_name: "Beta" }),
      late({ company_code: "3", company_name: "Beta" }),
      open({ company_code: "4", company_name: "Gama" }),
      open({ company_code: "4", company_name: "Gama" }),
      open({ company_code: "4", company_name: "Gama" }),
      done({ company_code: "5", company_name: "Só concluídas" }),
      doneLate({ company_code: "5", company_name: "Só concluídas" }),
    ];
    const { empresas } = computeRankings(tasks, 3);
    assert.deepEqual(
      empresas.map((e) => [e.codigo, e.nome, e.atrasadas, e.emAberto]),
      [
        ["3", "Beta", 2, 2],
        ["2", "Alfa", 1, 2], // empate com Zeta: ordem alfabética
        ["1", "Zeta", 1, 2],
      ],
    );
    assert.ok(!computeRankings(tasks, 10).empresas.some((e) => e.codigo === "5"), "sem tarefas em aberto não entra");
  });

  test("responsáveis: agrupa por id e trata ausente como 'Sem responsável'", () => {
    const { responsaveis } = computeRankings(
      [
        late({ owner_id: "o1", owner_name: "Ana" }),
        late({ owner_id: "o1", owner_name: "Ana" }),
        late({ owner_id: null, owner_name: null }),
        open({ owner_id: "o2", owner_name: "Bruno" }),
      ],
      10,
    );
    assert.deepEqual(
      responsaveis.map((r) => [r.nome, r.atrasadas, r.emAberto]),
      [
        ["Ana", 2, 2],
        ["Sem responsável", 1, 1],
        ["Bruno", 0, 1],
      ],
    );
  });
});

describe("documentos não enviados", () => {
  test("conta só extratos não desconsiderados; agrupa por competência, empresa e tarefa", () => {
    const docs = computeMissingDocuments([
      req({ gestta_task_id: "a", document_name: "Extratos de Conta Corrente", files_count: 0 }),
      req({ gestta_task_id: "a", document_name: "Extrato de Aplicação", files_count: 0 }),
      req({ gestta_task_id: "a", document_name: "Extrato de Cartão", files_count: 2 }),
      req({ gestta_task_id: "a", document_name: "Extrato Poupança", disconsidered: true }),
      req({ gestta_task_id: "a", document_name: "Demais Documentos", is_statement: false }),
      req({ gestta_task_id: "b", company_code: "200", company_name: "Beta", competence: "2026-08", task_due_date: "2026-09-15" }),
      req({ gestta_task_id: "c", task_status: "DISCONSIDERED" }),
    ]);
    // sem data de referência, nada é "vencido": tudo conta como a vencer
    assert.deepEqual(docs.totais, {
      solicitados: 4, recebidos: 1, faltando: 3, faltandoVencidos: 0, faltandoAVencer: 3,
      tarefasSemExtrato: 1, tarefasSemExtratoVencidas: 0, tarefasParciais: 1,
    });
    assert.deepEqual(docs.porCompetencia, [
      { competencia: "2026-08", solicitados: 1, recebidos: 0, faltando: 1, faltandoVencidos: 0 },
      { competencia: "2026-09", solicitados: 3, recebidos: 1, faltando: 2, faltandoVencidos: 0 },
    ]);
    assert.deepEqual(docs.porEmpresa, [
      { codigo: "100", nome: "ACME", faltando: 2, competencias: ["2026-09"] },
      { codigo: "200", nome: "Beta", faltando: 1, competencias: ["2026-08"] },
    ]);
    assert.equal(docs.pendencias.length, 2);
    assert.equal(docs.pendencias[0].tarefaId, "b", "vencimento mais antigo primeiro");
    assert.deepEqual(docs.pendencias[1].documentosFaltantes, ["Extratos de Conta Corrente", "Extrato de Aplicação"]);
    assert.equal(docs.pendencias[1].vencimento, "2026-10-15");
  });

  test("files_count nulo conta como faltando", () => {
    assert.equal(computeMissingDocuments([req({ files_count: null })]).totais.faltando, 1);
  });

  test("separa faltando em vencidos (vencimento antes de hoje) e a vencer", () => {
    const docs = computeMissingDocuments(
      [
        req({ gestta_task_id: "v1", task_due_date: "2026-11-10" }), // ontem: vencido
        req({ gestta_task_id: "v1", task_due_date: "2026-11-10", files_count: 1 }), // recebido: não conta
        req({ gestta_task_id: "h", task_due_date: "2026-11-11" }), // vence hoje: ainda não venceu
        req({ gestta_task_id: "f", task_due_date: "2026-12-15", competence: "2026-11" }), // futuro
        req({ gestta_task_id: "s", task_due_date: null }), // sem vencimento: a vencer
      ],
      "2026-11-11",
    );
    assert.deepEqual(
      { solicitados: docs.totais.solicitados, recebidos: docs.totais.recebidos, faltando: docs.totais.faltando, faltandoVencidos: docs.totais.faltandoVencidos, faltandoAVencer: docs.totais.faltandoAVencer },
      { solicitados: 5, recebidos: 1, faltando: 4, faltandoVencidos: 1, faltandoAVencer: 3 },
    );
    assert.equal(docs.totais.faltando, docs.totais.faltandoVencidos + docs.totais.faltandoAVencer);
    const byId = Object.fromEntries(docs.pendencias.map((p) => [p.tarefaId, p.vencido]));
    assert.deepEqual(byId, { v1: true, h: false, f: false, s: false });
    const set = docs.porCompetencia.find((g) => g.competencia === "2026-09")!;
    assert.equal(set.faltandoVencidos, 1);
    assert.equal(set.faltando, 3);
  });

  test("tarefa concluída pelo escritório não gera pendência, mas conta o que foi recebido", () => {
    const docs = computeMissingDocuments([
      req({ gestta_task_id: "fechada", task_status: "DONE", files_count: 0 }),
      req({ gestta_task_id: "fechada", task_status: "DONE", files_count: 0 }),
      req({ gestta_task_id: "fechada", task_status: "DONE", files_count: 3 }),
    ], "2026-11-11");
    assert.equal(docs.totais.faltando, 0);
    assert.equal(docs.totais.recebidos, 1);
    assert.equal(docs.totais.solicitados, 3);
    assert.equal(docs.totais.tarefasSemExtrato, 0);
    assert.equal(docs.pendencias.length, 0);
  });

  test("conta clientes por tarefa: sem nenhum extrato x parcial x completo", () => {
    const docs = computeMissingDocuments([
      // nada recebido (4 itens): 1 cliente sem extrato, vencido
      ...["CC", "Aplic", "Emprest", "Cotas"].map((n) => req({ gestta_task_id: "nada", document_name: n, task_due_date: "2026-11-01" })),
      // parcial
      req({ gestta_task_id: "parcial", document_name: "CC", files_count: 2 }),
      req({ gestta_task_id: "parcial", document_name: "Aplic" }),
      // completo
      req({ gestta_task_id: "ok", document_name: "CC", files_count: 1 }),
      // sem nada, ainda não venceu
      req({ gestta_task_id: "futuro", task_due_date: "2026-12-10" }),
    ], "2026-11-11");
    assert.equal(docs.totais.tarefasSemExtrato, 2);
    assert.equal(docs.totais.tarefasSemExtratoVencidas, 1);
    assert.equal(docs.totais.tarefasParciais, 1);
    const nada = docs.pendencias.find((p) => p.tarefaId === "nada")!;
    assert.deepEqual([nada.solicitados, nada.recebidos], [4, 0]);
    const parcial = docs.pendencias.find((p) => p.tarefaId === "parcial")!;
    assert.deepEqual([parcial.solicitados, parcial.recebidos], [2, 1]);
    assert.equal(docs.pendencias.some((p) => p.tarefaId === "ok"), false);
  });

  test("buildDashboard usa o dia de hoje em Brasília para vencidos", () => {
    // 01:30 UTC do dia 12 ainda é dia 11 em Brasília: tarefa com vencimento 11 não venceu
    const now = new Date("2026-11-12T01:30:00Z");
    const d = buildDashboard(
      { tasks: [task({ gestta_task_id: "tx" })], documentRequests: [req({ task_due_date: "2026-11-11" })], statementFiles: [], historyRecords: [], syncLogs: [] },
      { now },
    );
    assert.equal(d.documentos.totais.faltandoVencidos, 0);
    const later = buildDashboard(
      { tasks: [task({ gestta_task_id: "tx" })], documentRequests: [req({ task_due_date: "2026-11-11" })], statementFiles: [], historyRecords: [], syncLogs: [] },
      { now: new Date("2026-11-12T03:30:00Z") }, // já é dia 12 em Brasília
    );
    assert.equal(later.documentos.totais.faltandoVencidos, 1);
  });
});

describe("situação do Drive e envio", () => {
  test("extratos, cópias, convertidos, envio ao CRM-MEGA, histórico e sincronizações", () => {
    const drive = computeDriveStatus(
      [
        { format: "ofx", drive_file_id: "d1", delivery_status: "enviado", synced_at: "2026-11-10T10:00:00Z" },
        { format: "pdf", drive_file_id: null, delivery_status: "erro", synced_at: "2026-11-11T09:00:00Z" },
        { format: "ofx", drive_file_id: "d3", converted_from_id: "x", delivery_status: "nao_enviar" },
        { format: "pdf", drive_file_id: "d4", delivery_status: "enviando" },
        { format: "ofx", drive_file_id: null, delivery_status: null },
      ],
      [
        { drive_pdf_link: "p", drive_file_link: "f" },
        { drive_pdf_link: null, drive_file_link: "f" },
        { drive_pdf_link: null, drive_file_link: null },
      ],
      [
        { id: 1, started_at: "2026-11-11T10:00:00Z", finished_at: "2026-11-11T10:02:30Z", status: "success", tasks_checked: 900, companies_count: 300 },
        { id: 3, started_at: "2026-11-11T12:00:00Z", finished_at: "2026-11-11T12:00:05Z", status: "error", error_message: "Gestta 500" },
        { id: 2, started_at: "2026-11-11T11:00:00Z", finished_at: null, status: "running", metadata: { error: "x" } },
      ],
      2,
    );
    assert.deepEqual(drive.extratos, {
      total: 5,
      ofx: 3,
      pdf: 2,
      comCopiaDrive: 3,
      semCopiaDrive: 2,
      convertidos: 1,
      ultimaCaptura: "2026-11-11T09:00:00Z",
    });
    assert.deepEqual(drive.envioCrm, { enviado: 1, erro: 1, nao_enviar: 1, pendente: 2 });
    assert.deepEqual(drive.historico, { tarefas: 3, comPdfNoDrive: 1, comArquivoNoDrive: 2 });
    assert.equal(drive.ultimaSincronizacao?.id, "3");
    assert.equal(drive.ultimaSincronizacao?.status, "error");
    assert.equal(drive.ultimaSincronizacao?.erro, "Gestta 500");
    assert.equal(drive.ultimaSincronizacao?.duracaoSegundos, 5);
    assert.deepEqual(drive.execucoes.map((r) => r.id), ["3", "2"]);
    assert.equal(drive.execucoes[1].duracaoSegundos, null);
    assert.equal(drive.execucoes[1].erro, "x");
  });
});

describe("buildDashboard", () => {
  test("usa só a varredura mais recente e aplica filtros de empresa e responsável", () => {
    const OLD = "2026-11-10T13:00:00+00:00";
    const tasks = [
      late({ gestta_task_id: "a", company_code: "100", owner_name: "Ana" }),
      late({ gestta_task_id: "b", company_code: "200", owner_name: "Bruno" }),
      late({ gestta_task_id: "velha", synced_at: OLD }),
    ];
    assert.equal(currentSnapshot(tasks).length, 2);
    const input = {
      tasks,
      documentRequests: [
        req({ gestta_task_id: "a", company_code: "100" }),
        req({ gestta_task_id: "b", company_code: "200" }),
        req({ gestta_task_id: "velha" }),
      ],
      statementFiles: [{ company_code: "100" }, { company_code: "200" }],
      historyRecords: [],
      syncLogs: [],
    };
    const all = buildDashboard(input, { now: new Date("2026-11-11T15:00:00Z") });
    assert.equal(all.kpis.total, 2);
    assert.equal(all.retrato.sincronizadoEm, SYNC);
    assert.equal(all.documentos.totais.faltando, 2, "item da tarefa fora do retrato não conta");

    const byCompany = buildDashboard(input, { empresa: " 200 ", now: new Date("2026-11-11T15:00:00Z") });
    assert.equal(byCompany.kpis.total, 1);
    assert.equal(byCompany.filtros.empresa, "200");
    assert.equal(byCompany.documentos.totais.faltando, 1);
    assert.equal(byCompany.drive.extratos.total, 1);

    const byOwner = buildDashboard(input, { responsavel: "ana", now: new Date("2026-11-11T15:00:00Z") });
    assert.equal(byOwner.kpis.total, 1);
    assert.equal(byOwner.ranking.responsaveis[0].nome, "Ana");
    assert.equal(byOwner.documentos.pendencias[0].tarefaId, "a");
  });

  test("estrutura vazia válida e parâmetro de competências saneado", () => {
    const empty = emptyDashboard({ competencias: 3, now: new Date("2026-11-11T15:00:00Z") });
    assert.equal(empty.serie.length, 3);
    assert.equal(empty.kpis.total, 0);
    assert.equal(empty.drive.ultimaSincronizacao, null);
    assert.deepEqual(empty.documentos.pendencias, []);
    assert.equal(emptyDashboard({ competencias: Number("abc") }).serie.length, 6);
    assert.equal(emptyDashboard({ competencias: 0 }).serie.length, 6);
    assert.equal(emptyDashboard({ competencias: 999 }).serie.length, 36);
  });
});

// ------------------------------------------------------------------ leitura paginada

/** Consulta falsa do PostgREST: devolve fatias de `rows` conforme `.range()`. */
function fakeQuery(rows: any[], log: string[] = []) {
  const q: any = {
    select: () => q,
    eq: (col: string, val: string) => (log.push(`eq:${col}=${val}`), q),
    order: () => q,
    limit: (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null }),
    range: (from: number, to: number) => (log.push(`range:${from}-${to}`), Promise.resolve({ data: rows.slice(from, to + 1), error: null })),
  };
  return q;
}

describe("leitura paginada", () => {
  test("lê em páginas de 1000 até a página incompleta", async () => {
    const log: string[] = [];
    const rows = Array.from({ length: 2500 }, (_, i) => ({ i }));
    const all = await fetchAllPages(() => fakeQuery(rows, log));
    assert.equal(all.length, 2500);
    assert.deepEqual(log, ["range:0-999", "range:1000-1999", "range:2000-2999"]);
  });

  test("múltiplo exato de 1000 faz uma leitura extra vazia; erro é propagado", async () => {
    const log: string[] = [];
    const all = await fetchAllPages(() => fakeQuery(Array.from({ length: 2000 }, () => ({})), log));
    assert.equal(all.length, 2000);
    assert.equal(log.length, 3);
    await assert.rejects(
      fetchAllPages(() => ({ range: () => Promise.resolve({ data: null, error: { message: "boom" } }) })),
      /boom/,
    );
  });

  test("leitura em ondas paralelas mantém a ordem e para na primeira página incompleta", async () => {
    const log: string[] = [];
    const rows = Array.from({ length: 7300 }, (_, i) => ({ i }));
    const all = await fetchAllPages(() => fakeQuery(rows, log), 1000, 3);
    assert.equal(all.length, 7300);
    assert.deepEqual(all.map((r: any) => r.i), rows.map((r) => r.i), "ordem preservada");
    // 3 ondas de 3 páginas = 9 leituras; a 8ª (índice 7) é incompleta e a 9ª é descartada
    assert.equal(log.length, 9);
  });

  test("ondas paralelas não duplicam linhas quando o total é múltiplo exato", async () => {
    const log: string[] = [];
    const rows = Array.from({ length: 3000 }, (_, i) => ({ i }));
    const all = await fetchAllPages(() => fakeQuery(rows, log), 1000, 6);
    assert.equal(all.length, 3000);
    assert.equal(new Set(all.map((r: any) => r.i)).size, 3000);
  });

  test("erro em qualquer página da onda é propagado", async () => {
    let n = 0;
    await assert.rejects(
      fetchAllPages(() => ({ range: () => Promise.resolve(++n === 2 ? { data: null, error: { message: "falhou" } } : { data: Array(1000).fill({}), error: null }) }), 1000, 4),
      /falhou/,
    );
  });

  test("loadDashboardInput filtra as tarefas pela varredura mais recente", async () => {
    const log: string[] = [];
    const supabase = {
      from: (table: string) =>
        fakeQuery(table === "gestta_tasks" ? [{ synced_at: SYNC, gestta_task_id: "a" }] : [], log),
    };
    const input = await loadDashboardInput(supabase, { empresa: "100" });
    assert.equal(input.tasks.length, 1);
    assert.ok(log.includes(`eq:synced_at=${SYNC}`));
    assert.ok(log.includes("eq:company_code=100"));
  });
});
