import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  competenceFromTransactions,
  isOfcContent,
  OfcParseError,
  ofcToOfx,
  parseOfc,
  type OfcTransaction,
} from "../src/lib/ofc";
import {
  buildOfx,
  parseOfxAccount,
  parseOfxTransactions,
  type PdfStatementResult,
} from "../src/lib/pdf-to-ofx";

// ------------------------------------------------------------------ amostras

type TxSpec = {
  type?: string;
  date: string;
  amount: string;
  memo?: string;
  name?: string;
  fitId?: string;
};

/** Monta um OFC no layout típico (uma tag por linha, sem fechamento das folhas). */
function makeOfc(
  txs: TxSpec[],
  o: {
    bankId?: string;
    branchId?: string;
    accountId?: string;
    dtStart?: string;
    dtEnd?: string;
    ledger?: string;
    ledgerBal?: string;
    header?: string;
    eol?: string;
  } = {},
): string {
  const eol = o.eol ?? "\r\n";
  const lines: string[] = [];
  if (o.header) lines.push(o.header);
  lines.push(
    "<OFC>",
    "<DTSERVER>20260930120000",
    "<LANGUAGE>POR",
    "<ACCTSTMT>",
    "<ACCTFROM>",
  );
  if (o.bankId !== undefined) lines.push(`<BANKID>${o.bankId}`);
  if (o.branchId !== undefined) lines.push(`<BRANCHID>${o.branchId}`);
  if (o.accountId !== undefined) lines.push(`<ACCTID>${o.accountId}`);
  lines.push("<ACCTTYPE>0", "</ACCTFROM>", "<STMTRS>");
  if (o.dtStart !== undefined) lines.push(`<DTSTART>${o.dtStart}`);
  if (o.dtEnd !== undefined) lines.push(`<DTEND>${o.dtEnd}`);
  if (o.ledger !== undefined) lines.push(`<LEDGER>${o.ledger}`);
  for (const t of txs) {
    lines.push("<STMTTRN>");
    if (t.type !== undefined) lines.push(`<TRNTYPE>${t.type}`);
    lines.push(`<DTPOSTED>${t.date}`, `<TRNAMT>${t.amount}`);
    if (t.fitId !== undefined) lines.push(`<FITID>${t.fitId}`);
    lines.push("<CLTID>X");
    if (t.name !== undefined) lines.push(`<NAME>${t.name}`);
    if (t.memo !== undefined) lines.push(`<MEMO>${t.memo}`);
    lines.push("</STMTTRN>");
  }
  if (o.ledgerBal !== undefined)
    lines.push(`<LEDGERBAL><BALAMT>${o.ledgerBal}<DTASOF>20260930</LEDGERBAL>`);
  lines.push("</STMTRS>", "</ACCTSTMT>", "</OFC>", "");
  return lines.join(eol);
}

const ACC = {
  bankId: "0341",
  branchId: "1234",
  accountId: "567890",
  dtStart: "20260901",
  dtEnd: "20260930",
};

const SAMPLE = makeOfc(
  [
    {
      type: "1",
      date: "20260902",
      amount: "-150.00",
      memo: "PAGTO BOLETO",
      fitId: "0001",
    },
    {
      type: "0",
      date: "20260905",
      amount: "2000.00",
      memo: "TED RECEBIDA",
      fitId: "0002",
    },
    {
      type: "1",
      date: "20260910",
      amount: "-35.90",
      memo: "TARIFA",
      fitId: "0003",
    },
  ],
  { ...ACC, ledger: "1520.35" },
);

const latin1 = (s: string) => Buffer.from(s, "latin1");
const utf8 = (s: string) => Buffer.from(s, "utf8");

/** Confere que o erro é OfcParseError e que a mensagem bate. */
function assertOfcError(fn: () => unknown, re: RegExp) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(
      e instanceof OfcParseError,
      `esperava OfcParseError, veio ${String(e)}`,
    );
    assert.match((e as Error).message, re);
    return true;
  });
}

const amounts = (txs: OfcTransaction[]) => txs.map((t) => t.amount);

// ------------------------------------------------------------------ detecção

describe("isOfcContent", () => {
  test("OFC típico é detectado", () => {
    assert.equal(isOfcContent(latin1(SAMPLE)), true);
  });

  test("OFC com cabeçalho antes do <OFC>, com BOM e em minúsculas", () => {
    assert.equal(
      isOfcContent(
        latin1(
          makeOfc([], { ...ACC, header: "OFCHEADER:100\r\nDATA:OFCSGML\r\n" }),
        ),
      ),
      true,
    );
    assert.equal(
      isOfcContent(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(SAMPLE)]),
      ),
      true,
    );
    assert.equal(isOfcContent(latin1(SAMPLE.toLowerCase())), true);
  });

  test("OFC em UTF-16 com BOM", () => {
    const body = Buffer.from(SAMPLE, "utf16le");
    assert.equal(
      isOfcContent(Buffer.concat([Buffer.from([0xff, 0xfe]), body])),
      true,
    );
  });

  test("só o cabeçalho OFCHEADER (sem raiz nos primeiros KB) já indica OFC", () => {
    assert.equal(
      isOfcContent(latin1("OFCHEADER:100\r\nDATA:OFCSGML\r\n")),
      true,
    );
  });

  test("OFX gerado pelo buildOfx NÃO é OFC", () => {
    const r: PdfStatementResult = {
      ok: true,
      transactions: [{ date: "2026-09-02", amount: -150, description: "X" }],
      checkpoints: { passed: 0, failed: 0, details: [] },
      period: { start: "2026-09-01", end: "2026-09-30" },
      account: { bankId: "341", accountId: "1" },
    };
    assert.equal(isOfcContent(buildOfx(r, { fitIdPrefix: "t" })), false);
  });

  test("OFX sem cabeçalho (só <OFX>) e OFX 2 em XML NÃO são OFC", () => {
    assert.equal(
      isOfcContent(
        latin1(
          "<OFX><BANKMSGSRSV1><STMTTRNRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
        ),
      ),
      false,
    );
    assert.equal(
      isOfcContent(
        latin1(
          '<?xml version="1.0"?>\n<?OFX OFXHEADER="200" VERSION="220"?>\n<OFX></OFX>',
        ),
      ),
      false,
    );
  });

  test("OFX com cabeçalho que menciona OFC no corpo continua sendo OFX", () => {
    const ofx =
      "OFXHEADER:100\r\nDATA:OFXSGML\r\n\r\n<OFX>\r\n<MEMO>ARQUIVO <OFC> ANTIGO\r\n</OFX>";
    assert.equal(isOfcContent(latin1(ofx)), false);
  });

  test("cabeçalho OFXHEADER declarado manda, mesmo com raiz <OFC> (arquivo híbrido não é OFC)", () => {
    const hybrid =
      "OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\n\r\n" + SAMPLE;
    assert.equal(isOfcContent(latin1(hybrid)), false);
    assertOfcError(() => parseOfc(latin1(hybrid)), /não é um extrato OFC/);
  });

  test("PDF, texto aleatório, vazio e CSV NÃO são OFC", () => {
    assert.equal(
      isOfcContent(
        latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj <</Type /Catalog>> <OFC>"),
      ),
      false,
    );
    assert.equal(
      isOfcContent(latin1("Olá, segue o extrato de setembro em anexo.")),
      false,
    );
    assert.equal(isOfcContent(Buffer.alloc(0)), false);
    assert.equal(
      isOfcContent(latin1("data;valor;historico\n02/09/2026;-150,00;BOLETO\n")),
      false,
    );
    assert.equal(
      isOfcContent(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3])),
      false,
    ); // zip/xlsx
  });

  test("<OFC> além dos primeiros KB não é considerado", () => {
    assert.equal(isOfcContent(latin1(" ".repeat(20000) + SAMPLE)), false);
  });
});

// ------------------------------------------------------------------ leitura

describe("parseOfc — estrutura básica", () => {
  test("lê conta, período, saldo e lançamentos", () => {
    const st = parseOfc(latin1(SAMPLE));
    assert.deepEqual(st.account, {
      bankId: "341",
      branchId: "1234",
      accountId: "567890",
    });
    assert.deepEqual(st.period, { start: "2026-09-01", end: "2026-09-30" });
    assert.equal(st.closingBalance, 1520.35);
    assert.deepEqual(st.transactions, [
      {
        date: "2026-09-02",
        amount: -150,
        description: "PAGTO BOLETO",
        fitId: "0001",
      },
      {
        date: "2026-09-05",
        amount: 2000,
        description: "TED RECEBIDA",
        fitId: "0002",
      },
      {
        date: "2026-09-10",
        amount: -35.9,
        description: "TARIFA",
        fitId: "0003",
      },
    ]);
  });

  test("tudo numa linha só, sem quebras", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            { type: "1", date: "20260902", amount: "-150.00", memo: "A" },
            { type: "0", date: "20260903", amount: "10.00", memo: "B" },
          ],
          { ...ACC, ledger: "5.00", eol: "" },
        ),
      ),
    );
    assert.deepEqual(amounts(st.transactions), [-150, 10]);
    assert.deepEqual(
      st.transactions.map((t) => t.description),
      ["A", "B"],
    );
    assert.equal(st.account.accountId, "567890");
    assert.equal(st.closingBalance, 5);
  });

  test("só LF como fim de linha e tags em minúsculas", () => {
    const st = parseOfc(latin1(SAMPLE.replace(/\r\n/g, "\n").toLowerCase()));
    assert.deepEqual(amounts(st.transactions), [-150, 2000, -35.9]);
    assert.equal(st.account.bankId, "341");
  });

  test("lançamentos sem </STMTTRN> (SGML sem fechamento)", () => {
    const st = parseOfc(latin1(SAMPLE.replace(/<\/STMTTRN>\r\n/g, "")));
    assert.deepEqual(amounts(st.transactions), [-150, 2000, -35.9]);
    assert.equal(st.transactions[2].description, "TARIFA");
    assert.equal(st.closingBalance, 1520.35);
  });

  test("cabeçalho antes do <OFC> é ignorado", () => {
    const st = parseOfc(
      latin1(
        makeOfc([{ type: "1", date: "20260902", amount: "-1.00", memo: "X" }], {
          ...ACC,
          header: "OFCHEADER:100\r\nDATA:OFCSGML\r\nVERSION:102\r\n",
        }),
      ),
    );
    assert.equal(st.transactions.length, 1);
  });

  test("muitos lançamentos (vários <STMTTRN>) preservam ordem e quantidade", () => {
    const txs: TxSpec[] = [];
    for (let i = 1; i <= 120; i++) {
      const day = String(((i - 1) % 30) + 1).padStart(2, "0");
      txs.push({
        type: i % 2 ? "1" : "0",
        date: `202609${day}`,
        amount: `${i % 2 ? "-" : ""}${i}.${String(i % 100).padStart(2, "0")}`,
        memo: `L${i}`,
      });
    }
    const st = parseOfc(latin1(makeOfc(txs, ACC)));
    assert.equal(st.transactions.length, 120);
    assert.equal(st.transactions[0].amount, -1.01);
    assert.equal(st.transactions[119].amount, 120.2);
    assert.equal(st.transactions[119].description, "L120");
  });

  test("BANKID/ACCTID de conta de destino dentro do lançamento não substituem a conta do extrato", () => {
    const ofc = SAMPLE.replace(
      "<CLTID>X",
      "<CLTID>X\r\n<BANKACCTTO><BANKID>237<ACCTID>999</BANKACCTTO>",
    );
    const st = parseOfc(latin1(ofc));
    assert.deepEqual(st.account, {
      bankId: "341",
      branchId: "1234",
      accountId: "567890",
    });
  });
});

describe("parseOfc — TRNTYPE e sinal", () => {
  test("TRNTYPE numérico: 1 sem sinal vira débito, 0 sem sinal é crédito", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            { type: "1", date: "20260902", amount: "150.00" },
            { type: "0", date: "20260903", amount: "80.00" },
          ],
          ACC,
        ),
      ),
    );
    assert.deepEqual(amounts(st.transactions), [-150, 80]);
  });

  test("TRNTYPE texto: DEBIT sem sinal vira débito, CREDIT é crédito", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            { type: "DEBIT", date: "20260902", amount: "150.00" },
            { type: "credit", date: "20260903", amount: "80.00" },
          ],
          ACC,
        ),
      ),
    );
    assert.deepEqual(amounts(st.transactions), [-150, 80]);
  });

  test("tipos de saída (FEE, SRVCHG, PAYMENT, CHECK...) sem sinal viram débito; XFER/OTHER/DEP ficam positivos", () => {
    const types = [
      "FEE",
      "SRVCHG",
      "PAYMENT",
      "CHECK",
      "CASH",
      "DIRECTDEBIT",
      "XFER",
      "OTHER",
      "DEP",
      "INT",
    ];
    const st = parseOfc(
      latin1(
        makeOfc(
          types.map((type, i) => ({
            type,
            date: `202609${String(i + 1).padStart(2, "0")}`,
            amount: "10.00",
          })),
          ACC,
        ),
      ),
    );
    assert.deepEqual(
      amounts(st.transactions),
      [-10, -10, -10, -10, -10, -10, 10, 10, 10, 10],
    );
  });

  test("débito já com sinal negativo não vira positivo (não inverte duas vezes)", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            { type: "1", date: "20260902", amount: "-150.00" },
            { type: "DEBIT", date: "20260902", amount: "-1,50" },
          ],
          ACC,
        ),
      ),
    );
    assert.deepEqual(amounts(st.transactions), [-150, -1.5]);
  });

  test("sinal explícito prevalece sobre o TRNTYPE (estorno de crédito, débito com +)", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            { type: "0", date: "20260902", amount: "-20.00" },
            { type: "1", date: "20260903", amount: "+20.00" },
          ],
          ACC,
        ),
      ),
    );
    assert.deepEqual(amounts(st.transactions), [-20, 20]);
  });

  test("sem TRNTYPE: segue o sinal (sem sinal = crédito)", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            { date: "20260902", amount: "-5.00" },
            { date: "20260903", amount: "5.00" },
          ],
          ACC,
        ),
      ),
    );
    assert.deepEqual(amounts(st.transactions), [-5, 5]);
  });

  test("TRNTYPE numérico desconhecido com valor sem sinal é recusado; com sinal é aceito", () => {
    assertOfcError(
      () =>
        parseOfc(
          latin1(
            makeOfc([{ type: "4", date: "20260902", amount: "15.00" }], ACC),
          ),
        ),
      /TRNTYPE 4 desconhecido/,
    );
    const st = parseOfc(
      latin1(makeOfc([{ type: "4", date: "20260902", amount: "-15.00" }], ACC)),
    );
    assert.deepEqual(amounts(st.transactions), [-15]);
  });

  test("valor zero não vira -0", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            { type: "1", date: "20260902", amount: "0.00" },
            { type: "0", date: "20260902", amount: "-0,00" },
          ],
          ACC,
        ),
      ),
    );
    assert.ok(Object.is(st.transactions[0].amount, 0));
    assert.ok(Object.is(st.transactions[1].amount, 0));
  });
});

describe("parseOfc — valores", () => {
  const one = (amount: string, type = "0") =>
    parseOfc(latin1(makeOfc([{ type, date: "20260902", amount }], ACC)))
      .transactions[0].amount;

  test("ponto ou vírgula decimal", () => {
    assert.equal(one("-150.00"), -150);
    assert.equal(one("-150,00"), -150);
    assert.equal(one("1520,35"), 1520.35);
    assert.equal(one("12.5"), 12.5);
    assert.equal(one("12,5"), 12.5);
    assert.equal(one("12"), 12);
    assert.equal(one(",50"), 0.5);
    assert.equal(one("- 150,00"), -150);
    assert.equal(one("+7.10"), 7.1);
  });

  test("separador de milhar quando os dois separadores aparecem", () => {
    assert.equal(one("-1.234,56"), -1234.56);
    assert.equal(one("1,234.56"), 1234.56);
    assert.equal(one("1.234.567,89"), 1234567.89);
    assert.equal(one("12,345,678.90"), 12345678.9);
  });

  test("casas extras só se forem zeros", () => {
    assert.equal(one("150.0000"), 150);
    assertOfcError(() => one("1,0050"), /valor inválido ou ambíguo "1,0050"/);
  });

  test("centavos sem erro de ponto flutuante", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            { type: "0", date: "20260902", amount: "0.10" },
            { type: "0", date: "20260902", amount: "0.20" },
            { type: "1", date: "20260902", amount: "1234567.89" },
          ],
          ACC,
        ),
      ),
    );
    assert.deepEqual(amounts(st.transactions), [0.1, 0.2, -1234567.89]);
    const cents = st.transactions
      .slice(0, 2)
      .reduce((s, t) => s + Math.round(t.amount * 100), 0);
    assert.equal(cents, 30);
    assert.equal(one("0.07"), 0.07);
    assert.equal(one("1.15"), 1.15);
    assert.equal(one("4.35"), 4.35);
    assert.equal(one("-8.20"), -8.2);
  });

  test("valores inválidos ou ambíguos são recusados", () => {
    for (const bad of [
      "abc",
      "12a",
      "1.234",
      "1,234",
      "1.000",
      "2,500",
      "-10.000",
      "1.234.567",
      "1,23,45",
      "--5",
      "5-",
      "1.2.3,45",
      "1,234,5.00",
      "R$ 10,00",
      "",
      ".",
    ]) {
      assert.throws(() => one(bad), OfcParseError, `deveria recusar "${bad}"`);
    }
  });

  test("lançamento sem TRNAMT é recusado", () => {
    const ofc = SAMPLE.replace("<TRNAMT>2000.00\r\n", "");
    assertOfcError(
      () => parseOfc(latin1(ofc)),
      /lançamento 2 \(2026-09-05\): sem valor/,
    );
  });
});

describe("parseOfc — datas", () => {
  const one = (date: string) =>
    parseOfc(latin1(makeOfc([{ type: "0", date, amount: "1.00" }], ACC)))
      .transactions[0].date;

  test("AAAAMMDD com ou sem hora, milissegundos e fuso", () => {
    assert.equal(one("20260902"), "2026-09-02");
    assert.equal(one("20260902120000"), "2026-09-02");
    assert.equal(one("202609021200"), "2026-09-02");
    assert.equal(one("20260902120000[-3:BRT]"), "2026-09-02");
    assert.equal(one("20260902000000.000[-03:EST]"), "2026-09-02");
    assert.equal(one("20260902235959 [0:GMT]"), "2026-09-02");
    assert.equal(one("20240229"), "2024-02-29");
  });

  test("datas inválidas são recusadas", () => {
    for (const bad of [
      "20260230",
      "20261301",
      "20260001",
      "20260900",
      "20250229",
      "2026-09-02",
      "02/09/2026",
      "2026090",
      "20260902X",
      "abc",
    ]) {
      assert.throws(() => one(bad), OfcParseError, `deveria recusar "${bad}"`);
    }
  });

  test("mensagem diz qual lançamento e qual data", () => {
    const ofc = SAMPLE.replace("<DTPOSTED>20260905", "<DTPOSTED>20260931");
    assertOfcError(
      () => parseOfc(latin1(ofc)),
      /lançamento 2: data inválida "20260931"/,
    );
  });

  test("lançamento sem DTPOSTED é recusado", () => {
    const ofc = SAMPLE.replace("<DTPOSTED>20260910\r\n", "");
    assertOfcError(() => parseOfc(latin1(ofc)), /lançamento 3: sem data/);
  });

  test("DTSTART/DTEND inválidos ou invertidos são recusados; ausentes ficam sem período", () => {
    assertOfcError(
      () => parseOfc(latin1(makeOfc([], { ...ACC, dtStart: "20260931" }))),
      /DTSTART inválido/,
    );
    assertOfcError(
      () => parseOfc(latin1(makeOfc([], { ...ACC, dtEnd: "xx" }))),
      /DTEND inválido/,
    );
    assertOfcError(
      () =>
        parseOfc(
          latin1(
            makeOfc([], { ...ACC, dtStart: "20261001", dtEnd: "20260930" }),
          ),
        ),
      /período invertido/,
    );
    const st = parseOfc(
      latin1(
        makeOfc([{ type: "0", date: "20260902", amount: "1" }], {
          bankId: "1",
          accountId: "2",
        }),
      ),
    );
    assert.equal(st.period, undefined);
  });

  test("período com hora e fuso", () => {
    const st = parseOfc(
      latin1(
        makeOfc([], {
          ...ACC,
          dtStart: "20260901000000[-3:BRT]",
          dtEnd: "20260930235959[-3:BRT]",
        }),
      ),
    );
    assert.deepEqual(st.period, { start: "2026-09-01", end: "2026-09-30" });
  });
});

describe("parseOfc — descrição, conta, saldo e codificação", () => {
  test("MEMO e NAME: junta quando diferem, um só quando iguais ou faltando", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            {
              type: "0",
              date: "20260902",
              amount: "1",
              memo: "PIX RECEBIDO",
              name: "FULANO",
            },
            {
              type: "0",
              date: "20260902",
              amount: "1",
              memo: "TARIFA",
              name: "tarifa",
            },
            { type: "0", date: "20260902", amount: "1", name: "SO NAME" },
            { type: "0", date: "20260902", amount: "1", memo: "SO MEMO" },
            { type: "0", date: "20260902", amount: "1" },
            {
              type: "0",
              date: "20260902",
              amount: "1",
              memo: "  ESPACOS   DEMAIS  ",
            },
            {
              type: "0",
              date: "20260902",
              amount: "1",
              memo: "A &amp; B &lt;X&gt;",
            },
          ],
          ACC,
        ),
      ),
    );
    assert.deepEqual(
      st.transactions.map((t) => t.description),
      [
        "PIX RECEBIDO - FULANO",
        "TARIFA",
        "SO NAME",
        "SO MEMO",
        "Lançamento",
        "ESPACOS DEMAIS",
        "A & B <X>",
      ],
    );
  });

  test("FITID é opcional", () => {
    const st = parseOfc(
      latin1(makeOfc([{ type: "0", date: "20260902", amount: "1" }], ACC)),
    );
    assert.equal(st.transactions[0].fitId, undefined);
    assert.ok(!("fitId" in st.transactions[0]));
  });

  test("BANKID normalizado para 3 dígitos quando numérico", () => {
    const bank = (b: string) =>
      parseOfc(latin1(makeOfc([], { ...ACC, bankId: b }))).account.bankId;
    assert.equal(bank("0341"), "341");
    assert.equal(bank("341"), "341");
    assert.equal(bank("00001"), "001");
    assert.equal(bank("1"), "001");
    assert.equal(bank("033"), "033");
    assert.equal(bank("0756"), "756");
    assert.equal(bank("0000"), "000");
    assert.equal(bank("BRADESCO"), "BRADESCO");
  });

  test("conta sem BANKID/BRANCHID", () => {
    const st = parseOfc(
      latin1(
        makeOfc([], { accountId: "1", dtStart: "20260901", dtEnd: "20260930" }),
      ),
    );
    assert.deepEqual(st.account, { accountId: "1" });
  });

  test("mais de uma conta no mesmo arquivo é recusado", () => {
    const two = SAMPLE.replace(
      "</OFC>",
      "<ACCTSTMT><ACCTFROM><BANKID>341<ACCTID>111111</ACCTFROM><STMTRS></STMTRS></ACCTSTMT></OFC>",
    );
    assertOfcError(() => parseOfc(latin1(two)), /mais de uma conta/);
  });

  test("saldo em <LEDGER> e em <LEDGERBAL><BALAMT>; negativo e com vírgula", () => {
    assert.equal(
      parseOfc(latin1(makeOfc([], { ...ACC, ledger: "-1.234,56" })))
        .closingBalance,
      -1234.56,
    );
    assert.equal(
      parseOfc(latin1(makeOfc([], { ...ACC, ledgerBal: "987.65" })))
        .closingBalance,
      987.65,
    );
    assert.equal(parseOfc(latin1(makeOfc([], ACC))).closingBalance, undefined);
    assertOfcError(
      () => parseOfc(latin1(makeOfc([], { ...ACC, ledger: "1.234" }))),
      /saldo \(LEDGER\) inválido/,
    );
  });

  test("acentos em Windows-1252/latin1 no MEMO", () => {
    const st = parseOfc(
      latin1(
        makeOfc(
          [
            {
              type: "1",
              date: "20260902",
              amount: "-9.99",
              memo: "TRANSFERÊNCIA PIX JOÃO AÇÚCAR é ç ã",
            },
          ],
          ACC,
        ),
      ),
    );
    assert.equal(
      st.transactions[0].description,
      "TRANSFERÊNCIA PIX JOÃO AÇÚCAR é ç ã",
    );
  });

  test("caracteres exclusivos do Windows-1252 (0x80-0x9F)", () => {
    const buf = Buffer.concat([
      latin1(
        makeOfc(
          [{ type: "1", date: "20260902", amount: "-1", memo: "@@" }],
          ACC,
        ).replace("@@", ""),
      ),
    ]);
    const withEuro = Buffer.from(
      buf
        .toString("latin1")
        .replace("<MEMO>", "<MEMO>\u0080 TAXA \u0093X\u0094"),
      "latin1",
    );
    assert.equal(parseOfc(withEuro).transactions[0].description, "€ TAXA “X”");
  });

  test("UTF-8 com e sem BOM", () => {
    const body = makeOfc(
      [
        {
          type: "1",
          date: "20260902",
          amount: "-9.99",
          memo: "PAGAMENTO CONCESSIONÁRIA",
        },
      ],
      ACC,
    );
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      utf8(body),
    ]);
    assert.equal(
      parseOfc(withBom).transactions[0].description,
      "PAGAMENTO CONCESSIONÁRIA",
    );
    assert.equal(
      parseOfc(utf8(body)).transactions[0].description,
      "PAGAMENTO CONCESSIONÁRIA",
    );
    assert.equal(parseOfc(withBom).account.bankId, "341");
  });

  test("UTF-16LE com BOM", () => {
    const body = makeOfc(
      [{ type: "1", date: "20260902", amount: "-9.99", memo: "AÇÃO" }],
      ACC,
    );
    const st = parseOfc(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, "utf16le")]),
    );
    assert.equal(st.transactions[0].description, "AÇÃO");
    assert.equal(st.transactions[0].amount, -9.99);
  });
});

describe("parseOfc — sem movimento e não-OFC", () => {
  test("arquivo sem lançamentos é válido", () => {
    const st = parseOfc(latin1(makeOfc([], { ...ACC, ledger: "100.00" })));
    assert.deepEqual(st.transactions, []);
    assert.deepEqual(st.period, { start: "2026-09-01", end: "2026-09-30" });
    assert.equal(st.closingBalance, 100);
  });

  test("OFX, PDF e texto qualquer são recusados com OfcParseError", () => {
    const r: PdfStatementResult = {
      ok: true,
      transactions: [{ date: "2026-09-02", amount: -1, description: "X" }],
      checkpoints: { passed: 0, failed: 0, details: [] },
      account: {},
    };
    assertOfcError(
      () => parseOfc(buildOfx(r, { fitIdPrefix: "t" })),
      /não é um extrato OFC/,
    );
    assertOfcError(
      () => parseOfc(latin1("%PDF-1.4\n<OFC>")),
      /não é um extrato OFC/,
    );
    assertOfcError(() => parseOfc(latin1("bom dia")), /não é um extrato OFC/);
    assertOfcError(() => parseOfc(Buffer.alloc(0)), /não é um extrato OFC/);
  });

  test("OFC sem extrato (só a raiz) é recusado", () => {
    assertOfcError(
      () => parseOfc(latin1("<OFC>\r\n<DTSERVER>20260930\r\n</OFC>")),
      /não contém extrato/,
    );
  });

  test("OfcParseError é Error com nome próprio", () => {
    const e = new OfcParseError("x");
    assert.ok(e instanceof Error);
    assert.equal(e.name, "OfcParseError");
  });
});

// ------------------------------------------------------------------ conversão

describe("ofcToOfx — ida e volta", () => {
  /** Converte e confere que o OFX relido tem os mesmos lançamentos e a mesma conta. */
  function roundTrip(ofc: Buffer) {
    const { ofx, statement } = ofcToOfx(ofc, { fitIdPrefix: "ofc" });
    const back = parseOfxTransactions(ofx);
    assert.deepEqual(
      back.map((t) => ({ date: t.date, amount: t.amount })),
      statement.transactions.map((t) => ({ date: t.date, amount: t.amount })),
    );
    const acc = parseOfxAccount(ofx);
    assert.equal(acc.bankCode, statement.account.bankId || "000");
    assert.equal(acc.number, statement.account.accountId || "0");
    assert.equal(
      isOfcContent(ofx),
      false,
      "o OFX gerado não pode ser detectado como OFC",
    );
    return { ofx, statement, back, text: ofx.toString("latin1") };
  }

  test("amostra típica", () => {
    const { statement, back, text } = roundTrip(latin1(SAMPLE));
    assert.deepEqual(amounts(statement.transactions), [-150, 2000, -35.9]);
    assert.deepEqual(
      back.map((t) => t.description),
      ["PAGTO BOLETO", "TED RECEBIDA", "TARIFA"],
    );
    assert.match(text, /^OFXHEADER:100/);
    assert.match(text, /<BANKID>341\r\n/);
    assert.match(text, /<BRANCHID>1234\r\n/);
    assert.match(text, /<ACCTID>567890\r\n/);
    assert.match(text, /<DTSTART>20260901120000\[-3:BRT\]/);
    assert.match(text, /<DTEND>20260930120000\[-3:BRT\]/);
    assert.match(text, /<LEDGERBAL><BALAMT>1520\.35</);
    assert.match(
      text,
      /<TRNTYPE>DEBIT\r\n<DTPOSTED>20260902120000\[-3:BRT\]\r\n<TRNAMT>-150\.00/,
    );
    assert.match(
      text,
      /<TRNTYPE>CREDIT\r\n<DTPOSTED>20260905120000\[-3:BRT\]\r\n<TRNAMT>2000\.00/,
    );
  });

  test("débitos sem sinal pelo TRNTYPE, vírgula, milhar e datas com fuso", () => {
    const ofc = makeOfc(
      [
        {
          type: "1",
          date: "20260902120000[-3:BRT]",
          amount: "1.234,56",
          memo: "BOLETO",
        },
        { type: "DEBIT", date: "20260903", amount: "0,10", memo: "IOF" },
        { type: "0", date: "20260904", amount: "0.20", memo: "RENDIMENTO" },
        { type: "CREDIT", date: "20260905", amount: "1,234.00", memo: "TED" },
      ],
      { ...ACC, bankId: "00237", ledgerBal: "-0,46" },
    );
    const { statement, ofx } = roundTrip(latin1(ofc));
    assert.deepEqual(
      amounts(statement.transactions),
      [-1234.56, -0.1, 0.2, 1234],
    );
    assert.equal(parseOfxAccount(ofx).bankCode, "237");
    assert.match(ofx.toString("latin1"), /<BALAMT>-0\.46</);
  });

  test("acentos latin1 sobrevivem na ida e volta (OFX em Windows-1252)", () => {
    const ofc = makeOfc(
      [
        {
          type: "1",
          date: "20260902",
          amount: "-9.99",
          memo: "TRANSFERÊNCIA JOÃO",
        },
      ],
      ACC,
    );
    const { back, ofx } = roundTrip(latin1(ofc));
    assert.equal(back[0].description, "TRANSFERÊNCIA JOÃO");
    assert.ok(ofx.includes(Buffer.from([0xca]))); // Ê em Windows-1252
  });

  test("UTF-8 com BOM vira OFX em Windows-1252", () => {
    const ofc = makeOfc(
      [{ type: "1", date: "20260902", amount: "-9.99", memo: "AÇÃO" }],
      ACC,
    );
    const { back } = roundTrip(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(ofc)]),
    );
    assert.equal(back[0].description, "AÇÃO");
  });

  test("lançamentos repetidos (mesma data e valor) continuam todos no OFX com FITIDs distintos", () => {
    const tx = {
      type: "1",
      date: "20260902",
      amount: "-10.00",
      memo: "TARIFA",
    };
    const { back, text } = roundTrip(latin1(makeOfc([tx, tx, tx], ACC)));
    assert.equal(back.length, 3);
    const fitIds = [...text.matchAll(/<FITID>([^\r\n<]*)/g)].map((m) => m[1]);
    assert.equal(new Set(fitIds).size, 3);
    assert.ok(fitIds.every((f) => f.startsWith("ofc")));
  });

  test("sem movimento: OFX válido sem lançamentos, com período e saldo do OFC", () => {
    const { back, text, statement } = roundTrip(
      latin1(makeOfc([], { ...ACC, ledger: "100.00" })),
    );
    assert.equal(back.length, 0);
    assert.equal(statement.transactions.length, 0);
    assert.doesNotMatch(text, /<STMTTRN>/);
    assert.match(text, /<DTSTART>20260901/);
    assert.match(text, /<DTEND>20260930/);
    assert.match(text, /<BALAMT>100\.00</);
  });

  test("sem movimento e sem período: usa DTSERVER", () => {
    const { text } = roundTrip(
      latin1(makeOfc([], { bankId: "341", accountId: "1" })),
    );
    assert.match(text, /<DTSTART>20260930/);
    assert.match(text, /<DTEND>20260930/);
  });

  test("sem movimento, sem período e sem nenhuma data: recusa", () => {
    const ofc =
      "<OFC><ACCTSTMT><ACCTFROM><BANKID>341<ACCTID>1</ACCTFROM><STMTRS></STMTRS></ACCTSTMT></OFC>";
    assert.deepEqual(parseOfc(latin1(ofc)).transactions, []);
    assertOfcError(
      () => ofcToOfx(latin1(ofc), { fitIdPrefix: "x" }),
      /sem lançamentos e sem período/,
    );
  });

  test("sem DTSTART/DTEND: período vai da menor à maior data dos lançamentos", () => {
    const ofc = makeOfc(
      [
        { type: "1", date: "20260915", amount: "-1" },
        { type: "1", date: "20260903", amount: "-1" },
        { type: "1", date: "20260928", amount: "-1" },
      ],
      { bankId: "341", accountId: "1" },
    );
    const { text } = roundTrip(latin1(ofc));
    assert.match(text, /<DTSTART>20260903/);
    assert.match(text, /<DTEND>20260928/);
  });

  test("lançamento fora do DTSTART/DTEND amplia o período do OFX", () => {
    const ofc = makeOfc([{ type: "1", date: "20261002", amount: "-1" }], ACC);
    const { text, statement } = roundTrip(latin1(ofc));
    assert.deepEqual(statement.period, {
      start: "2026-09-01",
      end: "2026-09-30",
    });
    assert.match(text, /<DTSTART>20260901/);
    assert.match(text, /<DTEND>20261002/);
  });

  test("sem LEDGER: saldo do OFX é a soma dos lançamentos (comportamento do buildOfx)", () => {
    const ofc = makeOfc(
      [
        { type: "0", date: "20260902", amount: "0.10" },
        { type: "0", date: "20260902", amount: "0.20" },
      ],
      ACC,
    );
    const { text, statement } = roundTrip(latin1(ofc));
    assert.equal(statement.closingBalance, undefined);
    assert.match(text, /<BALAMT>0\.30</);
  });

  test("conta sem BANKID/ACCTID: OFX usa os padrões do buildOfx", () => {
    const ofc = makeOfc([{ type: "0", date: "20260902", amount: "1" }], {
      dtStart: "20260901",
      dtEnd: "20260930",
    });
    const { ofx } = roundTrip(latin1(ofc));
    assert.deepEqual(parseOfxAccount(ofx), { bankCode: "000", number: "0" });
  });

  test("erros de leitura propagam na conversão (não gera OFX errado)", () => {
    assertOfcError(
      () =>
        ofcToOfx(latin1(SAMPLE.replace("<TRNAMT>2000.00", "<TRNAMT>2.000")), {
          fitIdPrefix: "x",
        }),
      /valor inválido/,
    );
    assertOfcError(
      () =>
        ofcToOfx(
          latin1(SAMPLE.replace("<DTPOSTED>20260902", "<DTPOSTED>20260231")),
          { fitIdPrefix: "x" },
        ),
      /data inválida/,
    );
    assertOfcError(
      () => ofcToOfx(latin1("<OFX></OFX>"), { fitIdPrefix: "x" }),
      /não é um extrato OFC/,
    );
  });
});

// ------------------------------------------------------------------ competência

describe("competenceFromTransactions", () => {
  test("mês com mais lançamentos", () => {
    assert.equal(
      competenceFromTransactions([
        { date: "2026-08-31" },
        { date: "2026-09-01" },
        { date: "2026-09-15" },
        { date: "2026-10-01" },
      ]),
      "2026-09",
    );
  });

  test("empate → a mais recente (independente da ordem)", () => {
    assert.equal(
      competenceFromTransactions([
        { date: "2026-09-01" },
        { date: "2026-08-01" },
      ]),
      "2026-09",
    );
    assert.equal(
      competenceFromTransactions([
        { date: "2026-08-01" },
        { date: "2026-09-01" },
      ]),
      "2026-09",
    );
    assert.equal(
      competenceFromTransactions([
        { date: "2026-12-01" },
        { date: "2027-01-01" },
        { date: "2026-12-02" },
        { date: "2027-01-02" },
      ]),
      "2027-01",
    );
  });

  test("vazio ou sem datas válidas → null", () => {
    assert.equal(competenceFromTransactions([]), null);
    assert.equal(
      competenceFromTransactions([
        { date: "" },
        { date: "xx" },
        { date: "2026-13-01" },
      ]),
      null,
    );
  });

  test("usa os lançamentos lidos do OFC", () => {
    const st = parseOfc(latin1(SAMPLE));
    assert.equal(competenceFromTransactions(st.transactions), "2026-09");
  });
});
