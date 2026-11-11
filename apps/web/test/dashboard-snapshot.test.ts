import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mapTaskDetailToDocumentRequests,
  mapTaskDocToRow,
  saoPauloCompetence,
  saoPauloDate,
  saveDocumentRequests,
  saveTaskSnapshot,
  upsertInBatches,
  type GesttaDocumentRequestRow,
  type GesttaTaskRow,
  type SnapshotClient,
} from "../src/lib/dashboard/snapshot";

const SYNC = "2026-11-11T13:00:00.000Z";

// Documento real da busca (formato confirmado numa leitura do Gestta)
function searchDoc(p: Record<string, any> = {}) {
  return {
    _id: "t1",
    status: "OPEN",
    fine: false,
    total_step: 3,
    done_step: 1,
    done_overdue: false,
    done_fine: false,
    name: "DCTFWeb",
    type: "RECURRENT",
    subtype: "X",
    owner: { _id: "o1", active: true, name: "Ana" },
    customer: { _id: "c1", code: "100", name: "ACME LTDA" },
    created_at: "2024-04-15T12:24:57.335Z",
    conclusion_date: null,
    due_date: "2026-06-16T02:59:59.999Z",
    competence_date: "2026-05-02T02:59:59.999Z",
    overdue: true,
    ...p,
  };
}

describe("fuso America/Sao_Paulo", () => {
  test("fim do dia local gravado em UTC volta para o dia anterior", () => {
    assert.equal(saoPauloDate("2026-06-16T02:59:59.999Z"), "2026-06-15");
    assert.equal(saoPauloDate("2026-06-16T03:00:00.000Z"), "2026-06-16");
  });

  test("fronteira de mês: 01/10 02:59Z é 30/09 -> competência 2026-09", () => {
    assert.equal(saoPauloCompetence("2026-10-01T02:59:59.999Z"), "2026-09");
    assert.equal(saoPauloCompetence("2026-10-01T03:00:00.000Z"), "2026-10");
    // virada de ano
    assert.equal(saoPauloCompetence("2027-01-01T02:59:59.999Z"), "2026-12");
  });

  test("data pura e AAAA-MM não são deslocadas; lixo vira null", () => {
    assert.equal(saoPauloDate("2026-10-01"), "2026-10-01");
    assert.equal(saoPauloCompetence("2026-10"), "2026-10");
    assert.equal(saoPauloDate("ontem"), null);
    assert.equal(saoPauloDate("2026-13-45T00:00:00Z"), null);
    assert.equal(saoPauloDate(null), null);
    assert.equal(saoPauloDate(12345), null);
  });
});

describe("mapTaskDocToRow", () => {
  test("mapeia todos os campos com datas em Brasília", () => {
    const row = mapTaskDocToRow(searchDoc(), SYNC)!;
    assert.deepEqual(row, {
      gestta_task_id: "t1",
      name: "DCTFWeb",
      type: "RECURRENT",
      status: "OPEN",
      overdue: true,
      done_overdue: false,
      due_date: "2026-06-15",
      competence: "2026-05",
      conclusion_date: null,
      created_at_gestta: "2024-04-15T12:24:57.335Z",
      company_gestta_id: "c1",
      company_code: "100",
      company_name: "ACME LTDA",
      owner_id: "o1",
      owner_name: "Ana",
      steps_total: 3,
      steps_done: 1,
      synced_at: SYNC,
      updated_at: SYNC,
    });
  });

  test("competência no limite do mês usa o fuso (não slice(0, 7))", () => {
    const row = mapTaskDocToRow(searchDoc({ competence_date: "2026-10-01T02:59:59.999Z" }), SYNC)!;
    assert.equal(row.competence, "2026-09");
  });

  test("sem competence_date: não usa o vencimento como competência", () => {
    const row = mapTaskDocToRow(searchDoc({ competence_date: undefined }), SYNC)!;
    assert.equal(row.competence, null);
    assert.equal(mapTaskDocToRow(searchDoc({ competence_date: null, competence: "2026-04" }), SYNC)!.competence, "2026-04");
  });

  test("owner inexistente/nulo, cliente ausente e campos nulos", () => {
    const row = mapTaskDocToRow(
      { _id: "t9", owner: null, overdue: "true", total_step: "abc", due_date: "", created_at: "inválida" },
      SYNC,
    )!;
    assert.equal(row.owner_id, null);
    assert.equal(row.owner_name, null);
    assert.equal(row.company_code, null);
    assert.equal(row.company_name, null);
    assert.equal(row.overdue, false, "só true booleano conta como atraso");
    assert.equal(row.done_overdue, false);
    assert.equal(row.steps_total, null);
    assert.equal(row.due_date, null);
    assert.equal(row.created_at_gestta, null);
    assert.equal(row.name, null);
    assert.equal(mapTaskDocToRow({ _id: "t8" }, SYNC)!.owner_name, null);
  });

  test("código numérico vira texto; documento sem _id é descartado", () => {
    assert.equal(mapTaskDocToRow(searchDoc({ customer: { _id: "c", code: 42, name: " X " } }), SYNC)!.company_code, "42");
    assert.equal(mapTaskDocToRow(searchDoc({ customer: { code: 42, name: " X " } }), SYNC)!.company_name, "X");
    assert.equal(mapTaskDocToRow({ name: "sem id" }, SYNC), null);
    assert.equal(mapTaskDocToRow(null, SYNC), null);
  });
});

describe("mapTaskDetailToDocumentRequests", () => {
  const detail = {
    _id: "t1",
    name: "Envio de Extratos Bancários e Documentos Contábeis - ACME",
    status: "OPEN",
    customer: { _id: "c1", code: "100", name: "ACME LTDA" },
    due_date: "2026-10-16T02:59:59.999Z",
    competence_date: "2026-10-01T02:59:59.999Z",
    document_request: {
      requested_documents: [
        {
          _id: "r1",
          name: "Extratos de Conta Corrente (em .OFX e em .PDF)",
          disconsidered: false,
          files: [
            { _id: "f1", file_name: "a.ofx", upload_date: "2026-10-02T10:00:00.000Z", last_upload_date: "2026-10-03T10:00:00.000Z" },
            { _id: "f2", file_name: "a.pdf", upload_date: "2026-10-05T10:00:00.000Z" },
          ],
        },
        { _id: "r2", name: "Extrato de Aplicação", disconsidered: true, files: [] },
        { _id: "r3", name: "Demais Documentos", files: null },
        { name: "sem id" },
      ],
    },
  };

  test("uma linha por item com id, contagem de arquivos e último envio", () => {
    const rows = mapTaskDetailToDocumentRequests(detail, null, SYNC);
    assert.equal(rows.length, 3);
    const [r1, r2, r3] = rows;
    assert.equal(r1.requested_document_id, "r1");
    assert.equal(r1.is_statement, true);
    assert.equal(r1.files_count, 2);
    assert.equal(r1.last_upload_at, "2026-10-05T10:00:00.000Z");
    assert.equal(r1.competence, "2026-09", "competência no fuso de Brasília");
    assert.equal(r1.task_due_date, "2026-10-15");
    assert.equal(r1.company_code, "100");
    assert.equal(r2.is_statement, true);
    assert.equal(r2.disconsidered, true);
    assert.equal(r2.last_upload_at, null);
    assert.equal(r3.is_statement, false, "Demais Documentos não é extrato");
    assert.equal(r3.files_count, 0);
  });

  test("usa a tarefa da busca como reserva e tolera detalhe sem solicitação", () => {
    const listed = { _id: "t2", name: "Envio de Extratos", status: "DONE", customer: { _id: "c2", code: "200", name: "BETA" }, competence_date: "2026-08-02T02:59:59.999Z", due_date: "2026-09-16T02:59:59.999Z" };
    const rows = mapTaskDetailToDocumentRequests(
      { _id: "t2", document_request: { requested_documents: [{ _id: "r", name: "Extratos" }] } },
      listed,
      SYNC,
    );
    assert.equal(rows[0].company_name, "BETA");
    assert.equal(rows[0].competence, "2026-08");
    assert.equal(rows[0].task_status, "DONE");
    assert.equal(rows[0].task_due_date, "2026-09-15");
    assert.equal(rows[0].files_count, 0);
    assert.deepEqual(mapTaskDetailToDocumentRequests({ _id: "t3" }, null, SYNC), []);
    assert.deepEqual(mapTaskDetailToDocumentRequests(null, null, SYNC), []);
  });
});

// ------------------------------------------------------------------ gravação

function fakeClient(failOnCall: Set<number> = new Set(), throwOnCall: Set<number> = new Set()) {
  const calls: { table: string; rows: any[]; onConflict: string }[] = [];
  const client: SnapshotClient = {
    from(table) {
      return {
        upsert(rows, options) {
          const n = calls.length;
          calls.push({ table, rows, onConflict: options.onConflict });
          if (throwOnCall.has(n)) return Promise.reject(new Error("rede caiu"));
          return Promise.resolve({ error: failOnCall.has(n) ? { message: "violação" } : null });
        },
      };
    },
  };
  return { client, calls };
}

const taskRows = (n: number): GesttaTaskRow[] =>
  Array.from({ length: n }, (_, i) => mapTaskDocToRow(searchDoc({ _id: `t${i}` }), SYNC)!);

describe("gravação em lote", () => {
  test("fatia em lotes de 500 com onConflict da chave", async () => {
    const { client, calls } = fakeClient();
    const res = await saveTaskSnapshot(taskRows(1201), client);
    assert.deepEqual(calls.map((c) => c.rows.length), [500, 500, 201]);
    assert.ok(calls.every((c) => c.table === "gestta_tasks" && c.onConflict === "gestta_task_id"));
    assert.equal(res.enabled, true);
    assert.equal(res.written, 1201);
    assert.equal(res.batches, 3);
    assert.deepEqual(res.errors, []);
  });

  test("exatamente 500 linhas = 1 lote; vazio = nenhum lote", async () => {
    const a = fakeClient();
    await saveTaskSnapshot(taskRows(500), a.client);
    assert.equal(a.calls.length, 1);
    const b = fakeClient();
    const res = await saveTaskSnapshot([], b.client);
    assert.equal(b.calls.length, 0);
    assert.equal(res.written, 0);
  });

  test("falha parcial (erro devolvido ou exceção) não interrompe os demais lotes", async () => {
    const { client, calls } = fakeClient(new Set([0]), new Set([2]));
    const res = await upsertInBatches("gestta_tasks", taskRows(1600), "gestta_task_id", client);
    assert.equal(calls.length, 4);
    assert.equal(res.written, 600, "lotes 2 (500) e 4 (100) gravados");
    assert.equal(res.errors.length, 2);
    assert.match(res.errors[0], /linhas 1-500\): violação/);
    assert.match(res.errors[1], /linhas 1001-1500\): rede caiu/);
  });

  test("linhas repetidas na varredura são deduplicadas (última vence)", async () => {
    const { client, calls } = fakeClient();
    const rows = taskRows(3);
    const dup = { ...rows[0], status: "DONE" };
    await saveTaskSnapshot([...rows, dup], client);
    assert.equal(calls[0].rows.length, 3);
    assert.equal(calls[0].rows.find((r: GesttaTaskRow) => r.gestta_task_id === "t0").status, "DONE");
  });

  test("itens de documentos usam a chave composta", async () => {
    const { client, calls } = fakeClient();
    const base = { gestta_task_id: "t", requested_document_id: "r" } as GesttaDocumentRequestRow;
    const res = await saveDocumentRequests([base, { ...base }, { ...base, requested_document_id: "r2" }], client);
    assert.equal(calls[0].table, "gestta_document_requests");
    assert.equal(calls[0].onConflict, "gestta_task_id,requested_document_id");
    assert.equal(res.written, 2);
  });

  test("sem Supabase (null ou ambiente vazio) vira no-op sem erro", async () => {
    const res = await saveTaskSnapshot(taskRows(10), null);
    assert.equal(res.enabled, false);
    assert.equal(res.written, 0);
    assert.deepEqual(res.errors, []);

    const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    try {
      const env = await saveDocumentRequests([{ gestta_task_id: "t", requested_document_id: "r" } as any]);
      assert.equal(env.enabled, false);
      assert.deepEqual(env.errors, []);
    } finally {
      process.env.SUPABASE_URL = saved.url ?? "";
      process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key ?? "";
    }
  });
});
