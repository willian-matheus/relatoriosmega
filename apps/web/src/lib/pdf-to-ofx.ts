/**
 * Conversão de extrato bancário em PDF para OFX.
 *
 * Os bancos usam layouts diferentes, então a leitura é genérica:
 *  1. reconstrói as linhas do PDF pela posição do texto;
 *  2. cada linha que começa com data e tem valor monetário vira um lançamento;
 *     linhas de "saldo" viram pontos de conferência;
 *  3. CONFERE os lançamentos contra os saldos impressos no PDF: a variação entre
 *     dois saldos tem de ser igual à soma dos lançamentos entre eles.
 *
 * Só há OFX quando a conferência fecha. Um OFX com valores errados importado na
 * contabilidade é pior do que não ter OFX.
 */

export interface ParsedTransaction {
  date: string; // AAAA-MM-DD
  amount: number; // positivo = crédito, negativo = débito
  description: string;
}

export interface PdfStatementResult {
  ok: boolean;
  /** Motivo quando não foi possível converter com segurança */
  reason?: string;
  transactions: ParsedTransaction[];
  checkpoints: { passed: number; failed: number; details: string[] };
  openingBalance?: number;
  closingBalance?: number;
  period?: { start: string; end: string };
  account: { bankId?: string; branchId?: string; accountId?: string; bankName?: string };
}

// ---------------------------------------------------------------- leitura do PDF

async function extractLines(buffer: Buffer): Promise<string[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const lines: string[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows: { y: number; cells: { x: number; s: string }[] }[] = [];
    for (const item of content.items as any[]) {
      const s = String(item.str || "").trim();
      if (!s) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push((row = { y, cells: [] }));
      row.cells.push({ x, s });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.cells.sort((a, b) => a.x - b.x).map((c) => c.s));
  }
  await doc.destroy();
  return lines;
}

// ---------------------------------------------------------------- valores

// Valor monetário brasileiro: 1.234,56 | -1.234,56 | R$ 1.234,56 | -R$ 12,00 | 12,59 D | (12,59) | 93,10 (-)
const MONEY_RE =
  /(?<![\d.,])(-\s*)?(?:R\$\s*)?(-\s*)?(\(?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})(\)?)(?:\s*([CD])(?![A-Za-zÀ-ú]))?(?:\s*\(([+-])\))?(?![\d.,])/g;

interface MoneyToken {
  value: number;
  index: number;
  end: number;
  explicitSign: boolean;
}

function findMoney(text: string): MoneyToken[] {
  const out: MoneyToken[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const [, neg1, neg2, open, int, cents, close, cd, plusMinus] = m;
    let value = Number(int.replace(/\./g, "")) + Number(cents) / 100;
    const negative = Boolean(neg1 || neg2 || (open && close) || cd === "D" || plusMinus === "-");
    if (negative) value = -value;
    out.push({
      value,
      index: m.index!,
      end: m.index! + m[0].length,
      explicitSign: Boolean(neg1 || neg2 || cd || plusMinus || (open && close)),
    });
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- datas

// 01/09/2026 | 01-09-2026 | 01.09.2026 (Mercado Pago usa hífen)
const FULL_DATE = /^(\d{2})[\/.-](\d{2})[\/.-](\d{4}|\d{2})\b/;

function toIso(d: string, m: string, y: string): string | null {
  const year = y.length === 2 ? `20${y}` : y;
  const day = Number(d);
  const month = Number(m);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${m}-${d}`;
}

// ---------------------------------------------------------------- dados da conta

const KNOWN_BANKS: [RegExp, string, string][] = [
  [/banco do brasil|\bBB\b/i, "001", "Banco do Brasil"],
  [/pagseguro|pagbank/i, "290", "PagSeguro"],
  [/viacredi|ailos/i, "085", "Ailos"],
  [/sicoob/i, "756", "Sicoob"],
  [/sicredi/i, "748", "Sicredi"],
  [/bradesco/i, "237", "Bradesco"],
  [/ita[uú]/i, "341", "Itaú"],
  [/santander/i, "033", "Santander"],
  [/caixa econ/i, "104", "Caixa"],
  [/banco inter\b/i, "077", "Inter"],
  [/nubank|nu pagamentos/i, "260", "Nubank"],
  [/mercado pago/i, "323", "Mercado Pago"],
  [/cresol/i, "133", "Cresol"],
  [/unicred/i, "136", "Unicred"],
  [/\bc6 bank\b/i, "336", "C6 Bank"],
  [/stone/i, "197", "Stone"],
];

function detectAccount(header: string): PdfStatementResult["account"] {
  const account: PdfStatementResult["account"] = {};
  const bankCode = header.match(/\bBanco:?\s*(\d{3})\b/i) || header.match(/^\s*(\d{3})\s*-\s*[A-Za-z]/m);
  for (const [re, code, name] of KNOWN_BANKS) {
    if (re.test(header)) {
      account.bankId = code;
      account.bankName = name;
      break;
    }
  }
  if (bankCode) account.bankId = bankCode[1];
  const branch = header.match(/Ag[êe]ncia:?\s*\|?\s*([\d][\d.-]*)/i);
  if (branch) account.branchId = branch[1].replace(/\D/g, "");
  const acct = header.match(/Conta(?:\s+corrente)?:?\s*\|?\s*([\d][\d.\-]*\d|\d)/i);
  if (acct) account.accountId = acct[1].replace(/\D/g, "");
  return account;
}

// ---------------------------------------------------------------- leitura dos lançamentos

const BALANCE_WORDS = /\bsaldo\b|\bs\s*a\s*l\s*d\s*o\b/i;
const OPENING_WORDS = /saldo\s*anterior|saldo\s+inicial/i;
const FINAL_WORDS = /saldo\s+final/i;
// Saldos que não são da conta corrente (aplicação automática, bloqueado...): ignorados
const OTHER_BALANCE = /saldo\s+(invest|aplic|poupan|bloq|cdb|rende|em\s+aplica|dispon[íi]vel\s+para)/i;
// Totais e resumos (não são lançamentos)
const IGNORE_WORDS = /^(total|subtotal|resumo|entradas|sa[íi]das|cr[ée]ditos|d[ée]bitos)\b/i;
// Cabeçalho de colunas e rodapés: separam os grupos de descrição
const COLUMN_HEADER =
  /\b(data|dia)\b.*\b(valor|saldo|hist[óo]rico|lan[çc]amento|descri[çc][ãa]o)\b/i;
const FOOTER =
  /^(p[áa]gina|folha\b|emitido|data de gera|data da opera|os dados acima|voc[êe] tem alguma|o nosso sac|da ouvidoria|ouvidoria|mercado pago institui|\d+\s*\/\s*\d+$)/i;

type Item =
  | { kind: "tx"; tx: ParsedTransaction; ownDesc: string; balanceAfter?: number; prefix: string[]; suffix: string[] }
  | { kind: "balance"; value: number; label: string; role: "opening" | "checkpoint" }
  | { kind: "text"; text: string }
  | { kind: "break" };

function cleanDescription(text: string): string {
  return text
    .replace(/\b\d{2}[\/.-]\d{2}([\/.-]\d{2,4})?\b/g, " ") // datas
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ") // horas
    .replace(/(^|\s)[\d.\-\/]{5,}(?=\s|$)/g, " ") // números de documento/lote
    .replace(/(^|\s)#(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function parsePdfStatement(
  buffer: Buffer,
  hints: { fileName?: string } = {},
): Promise<PdfStatementResult> {
  const rawLines = await extractLines(buffer);
  const lines = rawLines.map((cells) => cells.join(" | "));
  // Cabeçalho + nome do arquivo (ex.: "Bradesco_123.pdf" quando o PDF não traz o nome do banco)
  const header = [lines.slice(0, 25).join("\n"), hints.fileName || ""].join("\n");
  const account = detectAccount(header);

  const periodMatch = lines
    .join(" ")
    .match(/(\d{2})[\/-](\d{2})[\/-](\d{4})\s*(?:\|\s*)?(?:a|al|até|e|-)\s*(?:\|\s*)?(\d{2})[\/-](\d{2})[\/-](\d{4})/i);
  let period = periodMatch
    ? { start: toIso(periodMatch[1], periodMatch[2], periodMatch[3])!, end: toIso(periodMatch[4], periodMatch[5], periodMatch[6])! }
    : undefined;
  // Período só com mês/ano (ex.: Banco do Brasil "Período do extrato 09 / 2026")
  const monthPeriod =
    !period && lines.join(" ").match(/per[íi]odo[^\d]{0,30}(\d{2})\s*\|?\s*\/\s*\|?\s*(\d{4})/i);
  if (monthPeriod) {
    const [, mm, yyyy] = monthPeriod;
    const lastDay = new Date(Date.UTC(Number(yyyy), Number(mm), 0)).getUTCDate();
    period = { start: `${yyyy}-${mm}-01`, end: `${yyyy}-${mm}-${String(lastDay).padStart(2, "0")}` };
  }

  const emptyResult = (reason: string): PdfStatementResult => ({
    ok: false,
    reason,
    transactions: [],
    checkpoints: { passed: 0, failed: 0, details: [] },
    period,
    account,
  });
  if (!rawLines.length) {
    return emptyResult("PDF escaneado (imagem): não há texto para ler; seria preciso OCR");
  }

  // ------------------------------------------------ 1. classifica cada linha
  const items: Item[] = [];
  let currentDate: string | undefined;
  let expectedFinal: number | undefined;
  let seenTx = false;

  for (const line of lines) {
    const plain = line.replace(/\s*\|\s*/g, " ").trim();
    if (!plain) continue;
    const money = findMoney(plain);

    if (OTHER_BALANCE.test(plain)) {
      items.push({ kind: "break" });
      continue;
    }

    if (BALANCE_WORDS.test(plain) && money.length) {
      const opening = plain.match(OPENING_WORDS);
      const final = plain.match(FINAL_WORDS);
      const after = (idx: number) => money.find((m) => m.index > idx)?.value;
      if (opening && final) {
        // "Saldo inicial: R$ 3.309,38 | Saldo final: R$ 3.255,38" na mesma linha
        const o = after(opening.index!);
        const f = after(final.index!);
        if (o !== undefined) items.push({ kind: "balance", value: round2(o), label: plain.slice(0, 60), role: "opening" });
        if (f !== undefined) expectedFinal = round2(f);
      } else if (opening && !seenTx) {
        items.push({ kind: "balance", value: round2(money[money.length - 1].value), label: plain.slice(0, 60), role: "opening" });
      } else if (final && !seenTx) {
        expectedFinal = round2(money[money.length - 1].value);
        items.push({ kind: "break" });
      } else {
        items.push({ kind: "balance", value: round2(money[money.length - 1].value), label: plain.slice(0, 60), role: "checkpoint" });
      }
      continue;
    }

    if (FOOTER.test(plain) || (COLUMN_HEADER.test(plain) && !money.length)) {
      items.push({ kind: "break" });
      continue;
    }

    const dateMatch = plain.match(FULL_DATE);
    const date = dateMatch ? toIso(dateMatch[1], dateMatch[2], dateMatch[3]) : null;
    if (date) currentDate = date;

    if (money.length && !IGNORE_WORDS.test(plain)) {
      // Linha sem data logo após lançamentos: mesmo dia do anterior (ex.: Bradesco). Só vale
      // quando antes do valor há apenas número de documento; texto antes do valor indica
      // quadro informativo (ex.: "Valor liberado..." no rodapé do BB), não lançamento.
      const textBeforeAmount = plain.slice(0, money[0].index);
      const carriesDate = seenTx && !/[A-Za-zÀ-ú]/.test(textBeforeAmount) && money.length >= 2;
      const txDate = date || (carriesDate ? currentDate : undefined);
      if (!txDate) {
        items.push({ kind: "break" });
        continue;
      }
      // Primeiro valor = lançamento; com mais de um, o último é o saldo após o lançamento
      const amountTok = money[0];
      const balanceTok = money.length > 1 ? money[money.length - 1] : undefined;
      const ownDesc = cleanDescription(plain.slice(dateMatch ? dateMatch[0].length : 0, amountTok.index));
      items.push({
        kind: "tx",
        tx: { date: txDate, amount: round2(amountTok.value), description: "" },
        ownDesc,
        balanceAfter: balanceTok ? round2(balanceTok.value) : undefined,
        prefix: [],
        suffix: [],
      });
      seenTx = true;
      continue;
    }

    if (money.length || dateMatch) {
      items.push({ kind: "break" });
      continue;
    }
    if (plain.length <= 120) items.push({ kind: "text", text: plain });
  }

  // ------------------------------------------------ 2. distribui as linhas de descrição
  // Bancos quebram o histórico antes e/ou depois da linha do valor. Entre dois lançamentos,
  // a 1ª linha completa o anterior e as demais iniciam o próximo; com uma linha só, ela vai
  // para o próximo quando ele não tem descrição própria.
  let prevAnchor: Item | null = null;
  let gap: string[] = [];
  const flushGap = (next: Item | null) => {
    const prevTx = prevAnchor?.kind === "tx" ? prevAnchor : null;
    const nextTx = next?.kind === "tx" ? next : null;
    if (gap.length) {
      if (prevTx && nextTx) {
        if (gap.length >= 2) {
          prevTx.suffix.push(gap[0]);
          nextTx.prefix.push(...gap.slice(1).slice(-2));
        } else if (!nextTx.ownDesc) nextTx.prefix.push(gap[0]);
        else prevTx.suffix.push(gap[0]);
      } else if (prevTx) prevTx.suffix.push(gap[0]);
      else if (nextTx) nextTx.prefix.push(...gap.slice(-2));
    }
    gap = [];
    prevAnchor = next;
  };
  for (const item of items) {
    if (item.kind === "text") gap.push(item.text);
    else flushGap(item);
  }
  flushGap(null);

  const entries: Exclude<Item, { kind: "text" | "break" }>[] = [];
  for (const item of items) {
    if (item.kind === "tx") {
      item.tx.description =
        cleanDescription([...item.prefix, item.ownDesc, ...item.suffix].filter(Boolean).join(" - ")).slice(0, 250) ||
        "Lançamento";
      entries.push(item);
    } else if (item.kind === "balance") entries.push(item);
  }

  // ---------------------------------------------------------------- conferência pelos saldos
  const checkpoints = { passed: 0, failed: 0, details: [] as string[] };
  let lastBalance: number | undefined;
  let sinceLast = 0;
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  const transactions: ParsedTransaction[] = [];

  const checkpoint = (value: number, label: string) => {
    if (lastBalance !== undefined) {
      const expected = round2(lastBalance + sinceLast);
      if (Math.abs(expected - value) < 0.005) checkpoints.passed++;
      else {
        checkpoints.failed++;
        if (checkpoints.details.length < 5) {
          checkpoints.details.push(`${label}: esperado ${expected.toFixed(2)}, impresso ${value.toFixed(2)}`);
        }
      }
    } else if (transactions.length && openingBalance === undefined) {
      // Primeiro saldo depois de lançamentos (ex.: PagSeguro só imprime "Saldo do dia"):
      // o saldo de abertura é deduzido
      openingBalance = round2(value - sinceLast);
    }
    if (openingBalance === undefined) openingBalance = value;
    lastBalance = value;
    closingBalance = value;
    sinceLast = 0;
  };

  for (const e of entries) {
    if (e.kind === "balance") {
      if (e.role === "opening" && lastBalance === undefined && !transactions.length) {
        openingBalance = e.value;
        lastBalance = e.value;
        closingBalance = e.value;
        continue;
      }
      checkpoint(e.value, e.label);
    } else {
      transactions.push(e.tx);
      sinceLast = round2(sinceLast + e.tx.amount);
      if (e.balanceAfter !== undefined) checkpoint(e.balanceAfter, `${e.tx.date} ${e.tx.description.slice(0, 30)}`);
    }
  }
  // "Saldo final" impresso no topo (ex.: Mercado Pago) é conferido no fim
  if (expectedFinal !== undefined && transactions.length) {
    if (lastBalance === undefined && openingBalance === undefined) {
      openingBalance = round2(expectedFinal - sinceLast);
    } else {
      checkpoint(expectedFinal, "Saldo final");
    }
    closingBalance = expectedFinal;
  }

  const base = { transactions, checkpoints, openingBalance, closingBalance, period, account };

  if (!transactions.length) {
    const fullText = lines.join(" ");
    let reason = "nenhum lançamento com data encontrado no PDF";
    if (/demonstrativo\s+de\s+aplica|aplica[çc][ãa]o\s+\d+/i.test(fullText)) {
      reason =
        "é um demonstrativo de aplicações (resumo mensal por aplicação, sem lançamentos com data); não é extrato de conta corrente";
    } else if (/saldo\s+de\s+conta|total\s+dos\s+saldos|n[ãa]o\s+h[áa]\s+lan[çc]amentos/i.test(fullText)) {
      reason = "o PDF mostra apenas saldos ou informa que não há lançamentos no período";
    }
    return { ok: false, reason, ...base };
  }
  if (checkpoints.passed === 0) {
    return {
      ok: false,
      reason: "o PDF não traz saldos para conferir os lançamentos (pode não ser um extrato)",
      ...base,
    };
  }
  if (checkpoints.failed > 0) {
    return {
      ok: false,
      reason: `os lançamentos lidos não fecham com os saldos do PDF (${checkpoints.failed} divergência(s))`,
      ...base,
    };
  }
  return { ok: true, ...base };
}

// ---------------------------------------------------------------- geração do OFX

function ofxDate(iso: string): string {
  return `${iso.replace(/-/g, "")}120000[-3:BRT]`;
}

function ofxText(s: string): string {
  // OFX 1.02 (SGML) em Windows-1252: remove caracteres de controle e escapa < > &
  return s
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 255);
}

/** Codifica em Windows-1252 (o charset declarado no cabeçalho do OFX). */
function toWindows1252(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    bytes.push(code <= 0xff ? code : 0x3f); // fora do Latin-1 vira "?"
  }
  return Buffer.from(bytes);
}

export function buildOfx(result: PdfStatementResult, opts: { fitIdPrefix: string }): Buffer {
  const txs = result.transactions;
  const dates = txs.map((t) => t.date).sort();
  const start = result.period?.start || dates[0];
  const end = result.period?.end || dates[dates.length - 1];
  const now = new Date();
  const nowIso = new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const closing =
    result.closingBalance ?? round2((result.openingBalance ?? 0) + txs.reduce((s, t) => s + t.amount, 0));

  const counters = new Map<string, number>();
  const stmtTrns = txs
    .map((t) => {
      const key = `${t.date}|${t.amount}`;
      const n = (counters.get(key) || 0) + 1;
      counters.set(key, n);
      const fitId = `${opts.fitIdPrefix}${t.date.replace(/-/g, "")}${Math.round(Math.abs(t.amount) * 100)}${t.amount < 0 ? "D" : "C"}${n}`;
      return [
        "<STMTTRN>",
        `<TRNTYPE>${t.amount < 0 ? "DEBIT" : "CREDIT"}`,
        `<DTPOSTED>${ofxDate(t.date)}`,
        `<TRNAMT>${t.amount.toFixed(2)}`,
        `<FITID>${fitId}`,
        `<MEMO>${ofxText(t.description)}`,
        "</STMTTRN>",
      ].join("\r\n");
    })
    .join("\r\n");

  const ofx = [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "SECURITY:NONE",
    "ENCODING:USASCII",
    "CHARSET:1252",
    "COMPRESSION:NONE",
    "OLDFILEUID:NONE",
    "NEWFILEUID:NONE",
    "",
    "<OFX>",
    "<SIGNONMSGSRSV1><SONRS>",
    "<STATUS><CODE>0<SEVERITY>INFO</STATUS>",
    `<DTSERVER>${ofxDate(nowIso)}`,
    "<LANGUAGE>POR",
    "</SONRS></SIGNONMSGSRSV1>",
    "<BANKMSGSRSV1><STMTTRNRS>",
    "<TRNUID>1",
    "<STATUS><CODE>0<SEVERITY>INFO</STATUS>",
    "<STMTRS>",
    "<CURDEF>BRL",
    "<BANKACCTFROM>",
    `<BANKID>${result.account.bankId || "000"}`,
    ...(result.account.branchId ? [`<BRANCHID>${result.account.branchId}`] : []),
    `<ACCTID>${result.account.accountId || "0"}`,
    "<ACCTTYPE>CHECKING",
    "</BANKACCTFROM>",
    "<BANKTRANLIST>",
    `<DTSTART>${ofxDate(start)}`,
    `<DTEND>${ofxDate(end)}`,
    stmtTrns,
    "</BANKTRANLIST>",
    `<LEDGERBAL><BALAMT>${closing.toFixed(2)}<DTASOF>${ofxDate(end)}</LEDGERBAL>`,
    "</STMTRS>",
    "</STMTTRNRS></BANKMSGSRSV1>",
    "</OFX>",
    "",
  ].join("\r\n");

  return toWindows1252(ofx);
}

// ---------------------------------------------------------------- leitura de OFX (para comparação)

/** Banco e conta declarados no OFX (BANKACCTFROM). */
export function parseOfxAccount(buffer: Buffer): { bankCode?: string; number?: string } {
  const text = buffer.toString("latin1");
  const tag = (name: string) => text.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() || undefined;
  return { bankCode: tag("BANKID"), number: tag("ACCTID") };
}

export function parseOfxTransactions(buffer: Buffer): ParsedTransaction[] {
  const text = buffer.toString("latin1");
  const out: ParsedTransaction[] = [];
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const tag = (name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() || "";
    const d = tag("DTPOSTED");
    const amount = Number(tag("TRNAMT").replace(",", "."));
    if (!/^\d{8}/.test(d) || Number.isNaN(amount)) continue;
    out.push({
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      amount: round2(amount),
      description: tag("MEMO") || tag("NAME"),
    });
  }
  return out;
}
