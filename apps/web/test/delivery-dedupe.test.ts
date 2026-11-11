import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  compareAccounts,
  normalizeAccountNumber,
  normalizeBankCode,
  planDeliveries,
  priorityOf,
  sameStatementReason,
  transactionOverlap,
  type DestinationStatement,
  type LocalStatement,
  type StatementTx,
} from "../src/lib/delivery/dedupe";
import { destinationCompetences, matchCompany, normalizeName } from "../src/lib/delivery/destination";

// ------------------------------------------------------------------ fábricas

const tx = (date: string, amount: number): StatementTx => ({ date, amount });
const SEPT: StatementTx[] = [
  tx("2026-09-01", 1500),
  tx("2026-09-02", -320.45),
  tx("2026-09-05", -89.9),
  tx("2026-09-10", 2000),
  tx("2026-09-15", -1200),
  tx("2026-09-30", -15.7),
];
const OCT: StatementTx[] = [tx("2026-10-01", 900), tx("2026-10-03", -50), tx("2026-10-20", -300)];

let seq = 0;
function local(p: Partial<LocalStatement> = {}): LocalStatement {
  seq++;
  return {
    id: p.id ?? `L${seq}`,
    companyKey: "cod:100",
    competence: "2026-09",
    format: "ofx",
    converted: false,
    sha256: p.sha256 ?? `sha-${seq}`,
    fileName: p.fileName ?? `arquivo-${seq}`,
    uploadedAt: "2026-10-02T10:00:00Z",
    account: { bankCode: "341", number: "12345-6" },
    transactions: SEPT,
    alreadySent: false,
    ...p,
  };
}

function dest(p: Partial<DestinationStatement> = {}): DestinationStatement {
  return {
    id: p.id ?? "D1",
    name: p.name ?? "Itaú — 09/2026",
    companyKey: "cod:100",
    account: { bankCode: "341", number: "123456" },
    transactions: SEPT,
    ...p,
  };
}

const competences = (d: DestinationStatement) => destinationCompetences(d);
const plan = (l: LocalStatement[], d: DestinationStatement[] = []) => planDeliveries(l, d, competences);
const actionOf = (decisions: ReturnType<typeof plan>, id: string) => decisions.find((x) => x.id === id)?.action;

// ------------------------------------------------------------------ contas

describe("contas bancárias", () => {
  test("normaliza código do banco e ignora códigos não numéricos", () => {
    assert.equal(normalizeBankCode("1"), "001");
    assert.equal(normalizeBankCode("341"), "341");
    assert.equal(normalizeBankCode("0341"), "341");
    assert.equal(normalizeBankCode("sciweb:itau"), null);
    assert.equal(normalizeBankCode(""), null);
    assert.equal(normalizeBankCode(null), null);
  });

  test("normaliza número da conta (só dígitos, sem zeros à esquerda, mínimo 3 dígitos)", () => {
    assert.equal(normalizeAccountNumber("00012345-6"), "123456");
    assert.equal(normalizeAccountNumber("12.345-X"), "12345");
    assert.equal(normalizeAccountNumber("-"), null);
    assert.equal(normalizeAccountNumber("12"), null);
    assert.equal(normalizeAccountNumber(undefined), null);
  });

  test("mesma conta com e sem dígito verificador", () => {
    assert.equal(compareAccounts({ number: "12345-6" }, { number: "12345" }), true);
    assert.equal(compareAccounts({ number: "12345" }, { number: "123456" }), true);
  });

  test("mesma conta com zeros à esquerda e formatação diferente", () => {
    assert.equal(compareAccounts({ number: "0001234567" }, { number: "1.234.567" }), true);
  });

  test("conta longa com prefixo de agência (carteiras digitais)", () => {
    assert.equal(compareAccounts({ number: "0001425015526" }, { number: "425015526" }), true);
  });

  test("contas diferentes", () => {
    assert.equal(compareAccounts({ number: "12345-6" }, { number: "98765-4" }), false);
    // não confundir com o caso do dígito verificador: prefixo, mas 2 dígitos a mais
    assert.equal(compareAccounts({ number: "1234567" }, { number: "12345" }), false);
  });

  test("mesmo número em bancos diferentes são contas diferentes", () => {
    assert.equal(compareAccounts({ bankCode: "341", number: "12345" }, { bankCode: "001", number: "12345" }), false);
  });

  test("conta desconhecida de um dos lados retorna null (não dá para saber)", () => {
    assert.equal(compareAccounts({ number: "12345" }, null), null);
    assert.equal(compareAccounts({ bankCode: "341" }, { bankCode: "341" }), null);
    assert.equal(compareAccounts(null, null), null);
  });

  test("banco não numérico não impede reconhecer a mesma conta", () => {
    assert.equal(compareAccounts({ bankCode: "sciweb:x", number: "555123" }, { bankCode: "341", number: "555123" }), true);
  });
});

// ------------------------------------------------------------------ lançamentos

describe("sobreposição de lançamentos", () => {
  test("idênticos = 100%", () => {
    assert.equal(transactionOverlap(SEPT, [...SEPT].reverse()), 1);
  });

  test("considera repetição (multiconjunto) e não conta o mesmo lançamento duas vezes", () => {
    const a = [tx("2026-09-01", -10), tx("2026-09-01", -10), tx("2026-09-01", -10)];
    const b = [tx("2026-09-01", -10)];
    assert.equal(transactionOverlap(a, b), 1); // 1 em comum / menor (1)
    assert.equal(transactionOverlap(b, a), 1);
    const c = [tx("2026-09-01", -10), tx("2026-09-01", -10)];
    assert.equal(transactionOverlap(a, c), 1); // 2 em comum / 2
  });

  test("o sinal importa (crédito ≠ débito do mesmo valor)", () => {
    assert.equal(transactionOverlap([tx("2026-09-01", 100)], [tx("2026-09-01", -100)]), 0);
  });

  test("arredonda centavos (ponto flutuante)", () => {
    assert.equal(transactionOverlap([tx("2026-09-01", 0.1 + 0.2)], [tx("2026-09-01", 0.3)]), 1);
  });

  test("lista vazia = 0", () => {
    assert.equal(transactionOverlap([], SEPT), 0);
    assert.equal(transactionOverlap(SEPT, []), 0);
  });

  test("extrato parcial (meio mês) dentro do mês completo conta como o mesmo", () => {
    assert.equal(transactionOverlap(SEPT.slice(0, 3), SEPT), 1);
  });
});

describe("mesmo extrato?", () => {
  test("contas diferentes nunca são o mesmo extrato, mesmo com lançamentos iguais", () => {
    assert.equal(
      sameStatementReason({ account: { number: "111111" }, transactions: SEPT }, { account: { number: "222222" }, transactions: SEPT }),
      null,
    );
  });

  test("lançamentos sobrepostos acima do limite = mesmo extrato", () => {
    const r = sameStatementReason({ account: null, transactions: SEPT }, { account: null, transactions: SEPT.slice(0, 4) });
    assert.match(r!, /100% dos lançamentos/);
  });

  test("exatamente 50% conta como o mesmo (limite inclusivo)", () => {
    const a = SEPT.slice(0, 4);
    const b = [...SEPT.slice(0, 2), tx("2026-09-20", 1), tx("2026-09-21", 2)];
    assert.ok(sameStatementReason({ account: null, transactions: a }, { account: null, transactions: b }));
  });

  test("lançamentos diferentes (outro período) = extratos diferentes", () => {
    assert.equal(sameStatementReason({ account: { number: "12345" }, transactions: SEPT }, { account: { number: "12345" }, transactions: OCT }), null);
  });

  test("PDF ilegível + mesma conta = mesmo extrato", () => {
    assert.match(
      sameStatementReason({ account: { number: "12345" }, transactions: null }, { account: { number: "12345-6" }, transactions: SEPT })!,
      /mesma conta/,
    );
  });

  test("PDF ilegível + conta desconhecida = considera o mesmo (na dúvida, não duplica)", () => {
    assert.match(sameStatementReason({ account: null, transactions: null }, { account: { number: "12345" }, transactions: SEPT })!, /sem como confirmar/);
  });

  test("extrato sem movimento no destino + mesma conta = mesmo extrato", () => {
    assert.ok(sameStatementReason({ account: { number: "12345" }, transactions: SEPT }, { account: { number: "12345" }, transactions: [] }));
  });
});

// ------------------------------------------------------------------ plano de envio

describe("plano de envio", () => {
  test("prioridade: OFX do cliente > OFX convertido > PDF", () => {
    assert.equal(priorityOf(local({ format: "ofx" })), 0);
    assert.equal(priorityOf(local({ format: "ofx", converted: true })), 1);
    assert.equal(priorityOf(local({ format: "pdf" })), 2);
  });

  test("OFX e PDF do mesmo extrato: vai só o OFX", () => {
    const ofx = local({ id: "ofx", format: "ofx" });
    const pdf = local({ id: "pdf", format: "pdf" });
    const d = plan([pdf, ofx]);
    assert.equal(actionOf(d, "ofx"), "send");
    assert.equal(actionOf(d, "pdf"), "skip");
    const skip = d.find((x) => x.id === "pdf");
    assert.ok(skip && skip.action === "skip" && skip.duplicateOf === "ofx");
  });

  test("OFX do cliente + OFX convertido + PDF da mesma conta: vai só o OFX do cliente", () => {
    const d = plan([
      local({ id: "pdf", format: "pdf" }),
      local({ id: "conv", format: "ofx", converted: true }),
      local({ id: "cli", format: "ofx" }),
    ]);
    assert.deepEqual(d.filter((x) => x.action === "send").map((x) => x.id), ["cli"]);
  });

  test("só PDF com OFX convertido: vai o convertido, o PDF não", () => {
    const d = plan([local({ id: "pdf", format: "pdf" }), local({ id: "conv", format: "ofx", converted: true })]);
    assert.equal(actionOf(d, "conv"), "send");
    assert.equal(actionOf(d, "pdf"), "skip");
  });

  test("o resultado não depende da ordem de entrada", () => {
    const files = () => [
      local({ id: "pdf", format: "pdf", uploadedAt: "2026-10-01T00:00:00Z" }),
      local({ id: "conv", format: "ofx", converted: true, uploadedAt: "2026-10-01T00:00:00Z" }),
      local({ id: "cli", format: "ofx", uploadedAt: "2026-10-05T00:00:00Z" }),
    ];
    const a = plan(files()).filter((x) => x.action === "send").map((x) => x.id);
    const b = plan(files().reverse()).filter((x) => x.action === "send").map((x) => x.id);
    assert.deepEqual(a, b);
    assert.deepEqual(a, ["cli"]);
  });

  test("mesmo arquivo enviado duas vezes pelo cliente (conteúdo idêntico): vai uma vez", () => {
    const d = plan([local({ id: "a", sha256: "igual" }), local({ id: "b", sha256: "igual" })]);
    assert.equal(d.filter((x) => x.action === "send").length, 1);
    assert.match((d.find((x) => x.action === "skip") as any).reason, /idêntico/);
  });

  test("o destino já tem o extrato: não envia e aponta qual é", () => {
    const d = plan([local({ id: "a" })], [dest({ id: "D-9", name: "Itaú (Conta 123456) — 09/2026" })]);
    const decision = d[0] as any;
    assert.equal(decision.action, "skip");
    assert.equal(decision.duplicateOf, "D-9");
    assert.match(decision.reason, /destino já tem/);
  });

  test("o destino tem extrato de OUTRA conta da mesma empresa: envia", () => {
    const d = plan([local({ id: "a" })], [dest({ account: { bankCode: "001", number: "999999" } })]);
    assert.equal(actionOf(d, "a"), "send");
  });

  test("o destino tem extrato de OUTRA competência: envia", () => {
    const d = plan([local({ id: "a" })], [dest({ transactions: OCT, name: "Itaú — 10/2026" })]);
    assert.equal(actionOf(d, "a"), "send");
  });

  test("extrato de OUTRA empresa com os mesmos lançamentos não bloqueia", () => {
    const d = plan([local({ id: "a", companyKey: "cod:200" })], [dest({ companyKey: "cod:100" })]);
    assert.equal(actionOf(d, "a"), "send");
  });

  test("o destino tem extrato vazio (sem movimento) da mesma conta: não envia", () => {
    const d = plan([local({ id: "a" })], [dest({ transactions: [], name: "Itaú — 09/2026" })]);
    assert.equal(actionOf(d, "a"), "skip");
  });

  test("duas contas diferentes na mesma competência: envia as duas", () => {
    const d = plan([
      local({ id: "itau", account: { bankCode: "341", number: "11111-1" } }),
      local({ id: "bb", account: { bankCode: "001", number: "22222-2" }, transactions: OCT.map((t) => ({ ...t, date: t.date.replace("-10-", "-09-") })) }),
    ]);
    assert.deepEqual(d.filter((x) => x.action === "send").map((x) => x.id).sort(), ["bb", "itau"]);
  });

  test("PDF ilegível de OUTRA conta (conta conhecida) é enviado", () => {
    const d = plan([
      local({ id: "ofx", account: { bankCode: "341", number: "11111" } }),
      local({ id: "pdf", format: "pdf", transactions: null, account: { bankCode: "001", number: "77777" } }),
    ]);
    assert.equal(actionOf(d, "pdf"), "send");
  });

  test("PDF ilegível sem conta identificada, em grupo com OFX: não envia (na dúvida)", () => {
    const d = plan([local({ id: "ofx" }), local({ id: "pdf", format: "pdf", transactions: null, account: null })]);
    assert.equal(actionOf(d, "pdf"), "skip");
  });

  test("PDF ilegível sozinho (sem OFX nem destino): é enviado para o destino ler", () => {
    const d = plan([local({ id: "pdf", format: "pdf", transactions: null, account: null })]);
    assert.equal(actionOf(d, "pdf"), "send");
  });

  test("arquivo já enviado antes bloqueia reenvio do mesmo extrato em outro formato", () => {
    const d = plan([local({ id: "ofx-antigo", alreadySent: true }), local({ id: "pdf-novo", format: "pdf" })]);
    assert.equal(d.length, 1, "o já enviado não recebe nova decisão");
    assert.equal(actionOf(d, "pdf-novo"), "skip");
    assert.match((d[0] as any).reason, /já enviado/);
  });

  test("arquivo novo de outro período da mesma conta (já enviado o anterior): envia", () => {
    const d = plan([
      local({ id: "set", alreadySent: true }),
      local({ id: "complemento", transactions: [tx("2026-09-28", 10), tx("2026-09-29", 20), tx("2026-09-30", 30)] }),
    ]);
    assert.equal(actionOf(d, "complemento"), "send");
  });

  test("competência desconhecida: não envia", () => {
    const d = plan([local({ id: "a", competence: null })]);
    assert.equal(actionOf(d, "a"), "skip");
  });

  test("todo arquivo pendente recebe exatamente uma decisão", () => {
    const files = [
      local({ id: "1" }),
      local({ id: "2", format: "pdf" }),
      local({ id: "3", sha256: "x" }),
      local({ id: "4", sha256: "x", companyKey: "cod:9" }),
      local({ id: "5", alreadySent: true, companyKey: "cod:9" }),
      local({ id: "6", competence: null }),
    ];
    const d = plan(files, [dest()]);
    const ids = d.map((x) => x.id).sort();
    assert.deepEqual(ids, ["1", "2", "3", "4", "6"]);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("cenário misto grande: nunca há dois envios do mesmo extrato", () => {
    // 20 empresas, cada uma com OFX + PDF + OFX duplicado; metade já está no destino
    const files: LocalStatement[] = [];
    const destination: DestinationStatement[] = [];
    for (let c = 0; c < 20; c++) {
      const key = `cod:${c}`;
      const acct = { bankCode: "341", number: `${10000 + c}` };
      const txs = SEPT.map((t) => ({ ...t, amount: t.amount + c }));
      files.push(local({ id: `${c}-ofx`, companyKey: key, account: acct, transactions: txs, sha256: `s${c}` }));
      files.push(local({ id: `${c}-ofx-dup`, companyKey: key, account: acct, transactions: txs, sha256: `s${c}` }));
      files.push(local({ id: `${c}-pdf`, companyKey: key, format: "pdf", account: acct, transactions: txs }));
      if (c % 2 === 0) destination.push(dest({ id: `D${c}`, companyKey: key, account: acct, transactions: txs }));
    }
    const d = plan(files, destination);
    const sent = d.filter((x) => x.action === "send").map((x) => x.id);
    assert.equal(sent.length, 10, "só as 10 empresas que o destino não tem");
    for (const id of sent) assert.match(id, /-ofx$/, "sempre o OFX, nunca o PDF nem a duplicata");
    for (const id of sent) assert.equal(Number(id.split("-")[0]) % 2, 1);
  });
});

// ------------------------------------------------------------------ empresa e competência no destino

describe("identificação no destino", () => {
  const companies = [
    { id: "A", name: "JSK SERVICOS ADMINISTRATIVOS LTDA", externalId: "1145", document: null },
    { id: "B", name: "OUTRA EMPRESA LTDA", externalId: "1146", document: "12.345.678/0001-90" },
    { id: "C", name: "Homônima Ltda", externalId: "1", document: null },
    { id: "D", name: "HOMONIMA LTDA", externalId: "2", document: null },
  ];

  test("normaliza nomes (acentos, espaços, sufixos societários)", () => {
    assert.equal(normalizeName("JSK SERVIÇOS ADMINISTRATIVOS  LTDA"), normalizeName("Jsk Servicos Administrativos"));
  });

  test("casa por código + nome", () => {
    assert.equal(matchCompany({ companyKey: "k", code: "1145", name: "JSK SERVIÇOS ADMINISTRATIVOS  LTDA", cnpj: null }, companies), "A");
  });

  test("casa por CNPJ quando o destino tem o documento", () => {
    assert.equal(matchCompany({ companyKey: "k", code: null, name: "Nome diferente", cnpj: "12345678000190" }, companies), "B");
  });

  test("código igual com nome diferente NÃO casa (código pode coincidir entre sistemas)", () => {
    assert.equal(matchCompany({ companyKey: "k", code: "1145", name: "EMPRESA SEM RELACAO", cnpj: null }, companies), null);
  });

  test("nome ambíguo usa o código para desempatar; sem código, não arrisca", () => {
    assert.equal(matchCompany({ companyKey: "k", code: "2", name: "Homonima", cnpj: null }, companies), "D");
    assert.equal(matchCompany({ companyKey: "k", code: null, name: "Homonima", cnpj: null }, companies), null);
  });

  test("competência do extrato do destino vem dos lançamentos", () => {
    assert.deepEqual(destinationCompetences(dest({ transactions: [tx("2026-08-31", 1), tx("2026-09-02", 2)] })).sort(), ["2026-08", "2026-09"]);
  });

  test("extrato vazio do destino: competência vem do nome", () => {
    assert.deepEqual(destinationCompetences(dest({ transactions: [], name: "Sicoob — 07/2026" })), ["2026-07"]);
    assert.deepEqual(destinationCompetences(dest({ transactions: [], name: "Extrato sem data" })), []);
  });
});
