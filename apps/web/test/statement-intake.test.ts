import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MAX_FILE_BYTES,
  receiveStatement,
  resolveCompetence,
  resolveFormat,
  type IntakeDeps,
  type IntakeInput,
} from "../src/lib/statement-intake";
import { normalizeScopes, STATEMENTS_READ_SCOPE, STATEMENTS_WRITE_SCOPE } from "../src/lib/api-tokens";
import { buildOfx, type PdfStatementResult } from "../src/lib/pdf-to-ofx";
import type { StatementFile } from "../src/lib/statements";

// ------------------------------------------------------------------ amostras

function ofx(txs: { date: string; amount: number }[] = [
  { date: "2026-09-02", amount: 1500 },
  { date: "2026-09-10", amount: -320.45 },
  { date: "2026-09-28", amount: -15.7 },
]): Buffer {
  const r: PdfStatementResult = {
    ok: true,
    transactions: txs.map((t) => ({ ...t, description: "x" })),
    checkpoints: { passed: 1, failed: 0, details: [] },
    period: { start: "2026-09-01", end: "2026-09-30" },
    account: { bankId: "341", accountId: "12345" },
  };
  return buildOfx(r, { fitIdPrefix: "t" });
}

const OFC = Buffer.from(
  [
    "<OFC>",
    "<ACCTSTMT><ACCTFROM><BANKID>0341<ACCTID>12345<ACCTTYPE>0</ACCTFROM>",
    "<STMTRS><DTSTART>20260801<DTEND>20260831<LEDGER>100.00",
    "<STMTTRN><TRNTYPE>0<DTPOSTED>20260805<TRNAMT>200.00<FITID>1<MEMO>PIX</STMTTRN>",
    "<STMTTRN><TRNTYPE>1<DTPOSTED>20260810<TRNAMT>100.00<FITID>2<MEMO>BOLETO</STMTTRN>",
    "</STMTRS></ACCTSTMT></OFC>",
  ].join("\r\n"),
  "latin1",
);
const PDF_ILEGIVEL = Buffer.from("%PDF-1.4\nconteudo que nao e um extrato legivel");

// ------------------------------------------------------------------ dependências falsas

interface Saved extends StatementFile {
  _metadata?: unknown;
}

let store: Map<string, Saved>;
let driveCopies: string[];
let conversions: string[];
let customers: { byCnpj: Record<string, any>; byCode: Record<string, any> };
let deps: IntakeDeps;
let driveFails = false;

function makeFile(input: any, format: StatementFile["format"]): Saved {
  return {
    id: `id-${store.size + 1}`,
    gesttaDocumentId: input.documentId,
    gesttaTaskId: input.task.id,
    source: input.received ? "api" : "gestta",
    receivedByTokenId: input.received?.tokenId ?? null,
    taskName: input.task.name,
    companyName: input.task.companyName,
    companyCode: input.task.companyCode ?? null,
    companyCnpj: input.task.companyCnpj ?? null,
    competence: input.task.competence ?? null,
    documentType: input.documentType ?? null,
    format,
    fileName: input.fileName,
    contentType: format === "pdf" ? "application/pdf" : format === "ofc" ? "application/x-ofc" : "application/x-ofx",
    fileSize: input.buffer.length,
    sha256: createHash("sha256").update(input.buffer).digest("hex"),
    uploadedAt: input.uploadedAt ?? null,
    syncedAt: input.syncedAt,
    driveFileId: null,
    driveFileLink: null,
    convertedFromId: input.conversion?.fromId ?? null,
    conversionNote: input.conversion?.note ?? null,
    _metadata: input.received?.metadata,
  };
}

beforeEach(() => {
  store = new Map();
  driveCopies = [];
  conversions = [];
  driveFails = false;
  customers = {
    byCnpj: { "12345678000190": { code: "100", name: "ACME LTDA", cnpj: "12.345.678/0001-90" } },
    byCode: {
      "100": { code: "100", name: "ACME LTDA", cnpj: "12345678000190" },
      "200": { code: "200", name: "BETA LTDA", cnpj: "98765432000110" },
    },
  };
  deps = {
    findCustomer: async ({ cnpj, code }) => ({
      byCnpj: cnpj ? customers.byCnpj[cnpj] ?? null : null,
      byCode: code ? customers.byCode[code] ?? null : null,
    }),
    findReceived: async (documentId) => [...store.values()].find((s) => s.gesttaDocumentId === documentId) ?? null,
    save: (async (input: any) => {
      const head = input.buffer.subarray(0, 64).toString("latin1");
      const format = head.startsWith("%PDF") ? "pdf" : /<OFC>/i.test(head) ? "ofc" : /OFXHEADER|<OFX>/i.test(head) ? "ofx" : null;
      if (!format) return null;
      const f = makeFile(input, format as any);
      store.set(f.id, f);
      return f;
    }) as any,
    convertOfc: async (s) => {
      conversions.push(`ofc:${s.id}`);
      const conv = makeFile({ documentId: `${s.gesttaDocumentId}-convertido-ofx`, task: { id: null, name: "", companyName: s.companyName, competence: s.competence }, fileName: "x.ofx", buffer: ofx(), syncedAt: "", conversion: { fromId: s.id, note: "n" }, received: { tokenId: s.receivedByTokenId } }, "ofx");
      store.set(conv.id, conv);
      return { ok: true, already: false, saved: conv, ofx: ofx() };
    },
    convertPdf: async (s) => {
      conversions.push(`pdf:${s.id}`);
      return { ok: false, reason: "os lançamentos lidos não fecham com os saldos do PDF" };
    },
    copyToDrive: async (s) => {
      if (driveFails) throw new Error("Drive fora do ar");
      driveCopies.push(s.id);
    },
    now: () => new Date("2026-11-11T15:00:00Z"),
  };
});

const input = (p: Partial<IntakeInput> = {}): IntakeInput => ({
  fileName: "extrato.ofx",
  buffer: ofx(),
  tokenId: "tok-1",
  cnpj: "12.345.678/0001-90",
  ...p,
});

// ------------------------------------------------------------------ formato e extensão

describe("formato e extensão", () => {
  test("aceita .ofx, .OFX, .pdf, .PDF, .ofc e .OFC", () => {
    for (const [name, buf, fmt] of [
      ["a.ofx", ofx(), "ofx"],
      ["A.OFX", ofx(), "ofx"],
      ["b.pdf", PDF_ILEGIVEL, "pdf"],
      ["B.PDF", PDF_ILEGIVEL, "pdf"],
      ["c.ofc", OFC, "ofc"],
      ["C.OFC", OFC, "ofc"],
      ["Misto.OfX", ofx(), "ofx"],
    ] as const) {
      assert.deepEqual(resolveFormat(name, buf), { format: fmt }, name);
    }
  });

  test("recusa outras extensões", () => {
    for (const name of ["a.csv", "a.xlsx", "a.txt", "a.ofx.zip", "semextensao", "a.qfx"]) {
      assert.ok("error" in resolveFormat(name, ofx()), name);
    }
  });

  test("recusa conteúdo que não corresponde à extensão", () => {
    assert.match((resolveFormat("a.ofx", PDF_ILEGIVEL) as any).error, /conteúdo é PDF/);
    assert.match((resolveFormat("a.pdf", ofx()) as any).error, /não é PDF/);
    assert.match((resolveFormat("a.ofc", PDF_ILEGIVEL) as any).error, /conteúdo é PDF/);
    assert.match((resolveFormat("a.ofx", Buffer.from("texto qualquer")) as any).error, /não é um OFX válido/);
  });

  test("OFX e OFC trocados de extensão são aceitos pelo conteúdo (ambos estruturados)", () => {
    assert.deepEqual(resolveFormat("a.ofc", ofx()), { format: "ofx" });
    assert.deepEqual(resolveFormat("a.ofx", OFC), { format: "ofc" });
  });
});

describe("competência", () => {
  test("valida a informada", async () => {
    assert.deepEqual(await resolveCompetence("2026-09", "ofx", ofx(), "a.ofx"), { competence: "2026-09" });
    assert.ok("error" in (await resolveCompetence("09/2026", "ofx", ofx(), "a.ofx")));
    assert.ok("error" in (await resolveCompetence("2026-13", "ofx", ofx(), "a.ofx")));
  });
  test("deduz dos lançamentos do OFX e do OFC", async () => {
    assert.deepEqual(await resolveCompetence(null, "ofx", ofx(), "a.ofx"), { competence: "2026-09" });
    assert.deepEqual(await resolveCompetence("", "ofc", OFC, "a.ofc"), { competence: "2026-08" });
  });
  test("PDF ilegível sem competência informada é recusado", async () => {
    assert.ok("error" in (await resolveCompetence(null, "pdf", PDF_ILEGIVEL, "a.pdf")));
  });
});

// ------------------------------------------------------------------ recebimento

describe("recebimento", () => {
  test("recebe OFX, identifica a empresa pelo CNPJ e copia no Drive", async () => {
    const r = await receiveStatement(input({ metadata: { banco: "Itaú" } }), deps);
    assert.equal(r.status, 201);
    const b = r.body as any;
    assert.equal(b.formato, "ofx");
    assert.equal(b.competencia, "2026-09");
    assert.deepEqual(b.empresa, { codigo: "100", cnpj: "12345678000190", nome: "ACME LTDA", identificada: true });
    assert.equal(b.tipoDocumento, "Extratos de Conta Corrente (recebido pela API)");
    assert.equal(b.convertido, null);
    assert.deepEqual(driveCopies, [b.id]);
    const saved = store.get(b.id)!;
    assert.equal(saved.source, "api");
    assert.equal(saved.gesttaTaskId, null);
    assert.equal(saved.receivedByTokenId, "tok-1");
    assert.equal((saved._metadata as any).banco, "Itaú");
    assert.equal(saved.gesttaDocumentId, `api:${saved.sha256}`);
  });

  test("identifica pelo código quando não há CNPJ", async () => {
    const r = await receiveStatement(input({ cnpj: null, empresaCodigo: "200" }), deps);
    assert.equal(r.status, 201);
    assert.equal((r.body as any).empresa.nome, "BETA LTDA");
    assert.equal((r.body as any).empresa.cnpj, "98765432000110");
  });

  test("CNPJ e código de empresas diferentes: recusa", async () => {
    const r = await receiveStatement(input({ empresaCodigo: "200" }), deps);
    assert.equal(r.status, 422);
    assert.equal(store.size, 0);
  });

  test("empresa fora do cadastro: recebe com os dados informados e avisa que não foi identificada", async () => {
    const r = await receiveStatement(input({ cnpj: "11222333000181", empresaNome: "Nova Empresa" }), deps);
    assert.equal(r.status, 201);
    assert.deepEqual((r.body as any).empresa, { codigo: null, cnpj: "11222333000181", nome: "Nova Empresa", identificada: false });
  });

  test("sem CNPJ nem código: recusa com explicação", async () => {
    const r = await receiveStatement(input({ cnpj: null, empresaCodigo: null }), deps);
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /cnpj/);
  });

  test("CNPJ com tamanho inválido: recusa; CPF (11 dígitos) é aceito", async () => {
    assert.equal((await receiveStatement(input({ cnpj: "123" }), deps)).status, 400);
    customers.byCnpj["52998224725"] = { code: "300", name: "PESSOA FISICA", cnpj: "52998224725" };
    assert.equal((await receiveStatement(input({ cnpj: "529.982.247-25" }), deps)).status, 201);
  });

  test("tipo inválido é recusado; tipos válidos ganham o nome do padrão Gestta", async () => {
    assert.equal((await receiveStatement(input({ tipo: "cartao" }), deps)).status, 400);
    const r = await receiveStatement(input({ tipo: "Aplicacao", buffer: ofx([{ date: "2026-09-05", amount: 10 }]) }), deps);
    assert.equal((r.body as any).tipoDocumento, "Extratos de Aplicações Financeiras (recebido pela API)");
  });

  test("mesmo arquivo enviado de novo: não duplica e responde 200", async () => {
    const first = await receiveStatement(input(), deps);
    const again = await receiveStatement(input({ fileName: "outro-nome.OFX" }), deps);
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal((again.body as any).duplicado, true);
    assert.equal((again.body as any).id, (first.body as any).id);
    assert.equal(store.size, 1);
    assert.equal(driveCopies.length, 1, "não copia de novo no Drive");
  });

  test("OFC: guarda o original e gera o OFX convertido (os dois vão ao Drive)", async () => {
    const r = await receiveStatement(input({ fileName: "EXTRATO.OFC", buffer: OFC }), deps);
    assert.equal(r.status, 201);
    const b = r.body as any;
    assert.equal(b.formato, "ofc");
    assert.equal(b.competencia, "2026-08");
    assert.ok(b.convertido?.id);
    assert.equal(b.convertido.formato, "ofx");
    assert.deepEqual(conversions, [`ofc:${b.id}`]);
    assert.deepEqual(driveCopies, [b.id, b.convertido.id]);
  });

  test("PDF de conta corrente: tenta converter; se não fechar com os saldos, recebe e avisa", async () => {
    const r = await receiveStatement(input({ fileName: "Extrato.PDF", buffer: PDF_ILEGIVEL, competencia: "2026-09" }), deps);
    assert.equal(r.status, 201);
    const b = r.body as any;
    assert.equal(b.formato, "pdf");
    assert.equal(b.convertido, null);
    assert.match(b.avisos.join(" "), /não foi gerado OFX/);
  });

  test("PDF de aplicação não tenta conversão (OFX é de conta corrente)", async () => {
    await receiveStatement(input({ fileName: "a.pdf", buffer: PDF_ILEGIVEL, competencia: "2026-09", tipo: "aplicacao" }), deps);
    assert.deepEqual(conversions, []);
  });

  test("falha no Drive não desfaz o recebimento (vira aviso)", async () => {
    driveFails = true;
    const r = await receiveStatement(input(), deps);
    assert.equal(r.status, 201);
    assert.equal(store.size, 1);
    assert.match((r.body as any).avisos[0], /Drive/);
  });

  test("arquivo vazio, grande demais, extensão ou conteúdo errado: recusa sem gravar", async () => {
    assert.equal((await receiveStatement(input({ buffer: Buffer.alloc(0) }), deps)).status, 400);
    const big = Buffer.concat([ofx(), Buffer.alloc(MAX_FILE_BYTES)]);
    assert.equal((await receiveStatement(input({ buffer: big }), deps)).status, 413);
    assert.equal((await receiveStatement(input({ fileName: "a.csv" }), deps)).status, 415);
    assert.equal((await receiveStatement(input({ fileName: "a.ofx", buffer: PDF_ILEGIVEL }), deps)).status, 415);
    assert.equal(store.size, 0);
    assert.equal(driveCopies.length, 0);
  });

  test("nome de arquivo com caminho é limpo (sem / nem \\)", async () => {
    const r = await receiveStatement(input({ fileName: "../../etc/extrato.ofx" }), deps);
    assert.equal(r.status, 201);
    assert.ok(!store.get((r.body as any).id)!.fileName.includes("/"));
  });
});

describe("permissões do token", () => {
  test("padrão é só leitura; aceita leitura, envio ou ambos; recusa inválidas e vazio", () => {
    assert.deepEqual(normalizeScopes(undefined), [STATEMENTS_READ_SCOPE]);
    assert.deepEqual(normalizeScopes([STATEMENTS_WRITE_SCOPE]), [STATEMENTS_WRITE_SCOPE]);
    assert.deepEqual(normalizeScopes([STATEMENTS_WRITE_SCOPE, STATEMENTS_READ_SCOPE, STATEMENTS_WRITE_SCOPE]), [STATEMENTS_READ_SCOPE, STATEMENTS_WRITE_SCOPE]);
    assert.throws(() => normalizeScopes([]), /ao menos uma/);
    assert.throws(() => normalizeScopes(["admin"]), /inválida/);
    assert.throws(() => normalizeScopes("extratos:read"), /ao menos uma/);
  });
});
