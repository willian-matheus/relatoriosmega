/**
 * Leitura de extratos bancários no formato OFC (Open Financial Connectivity) e
 * conversão para OFX.
 *
 * OFC é o formato antigo do Microsoft Money, ainda exportado por alguns bancos
 * brasileiros com extensão `.ofc`. É SGML parecido com o OFX 1.x, com raiz `<OFC>`:
 *
 *   <OFC> <ACCTSTMT> <ACCTFROM> BANKID/BRANCHID/ACCTID </ACCTFROM>
 *         <STMTRS> DTSTART/DTEND/LEDGER <STMTTRN>...</STMTTRN> </STMTRS> </ACCTSTMT> </OFC>
 *
 * Variações tratadas (o leitor é tolerante na forma, rigoroso no conteúdo):
 *  - tags sem fechamento, maiúsculas ou minúsculas, com ou sem quebra de linha
 *    (tudo numa linha só também funciona) e cabeçalho (OFCHEADER:...) antes do `<OFC>`;
 *  - codificação: BOM UTF-8 ou UTF-16; sem BOM, UTF-8 válido ou, senão, Windows-1252
 *    (superconjunto do latin1 usado pelos bancos para acentos no MEMO);
 *  - TRNTYPE numérico (0 = crédito, 1 = débito) ou texto (CREDIT, DEBIT, FEE...);
 *  - TRNAMT com ponto ou vírgula decimal, separador de milhar quando os dois aparecem
 *    ("1.234,56" / "1,234.56"), sinal "+"/"-" (inclusive com espaço: "- 150,00");
 *  - TRNAMT sem sinal com TRNTYPE de débito vira negativo; sinal explícito sempre prevalece
 *    (é a regra do OFX: o sinal do valor é o que vale);
 *  - datas AAAAMMDD com ou sem hora, milissegundos e fuso: 20260902120000.000[-3:BRT]
 *    (usa-se a data como escrita, sem converter fuso);
 *  - descrição em MEMO e/ou NAME (junta "MEMO - NAME" quando os dois existem e diferem);
 *  - saldo em `<LEDGER>` ou `<LEDGERBAL><BALAMT>`;
 *  - BANKID com zeros à esquerda é normalizado para 3 dígitos ("0341" → "341", "1" → "001");
 *  - arquivo sem lançamentos (sem movimento) é válido.
 *
 * O que é RECUSADO (OfcParseError), porque um OFX errado importado na contabilidade é
 * pior do que nenhum OFX:
 *  - conteúdo que não é OFC (OFX, PDF, texto qualquer) ou OFC sem extrato;
 *  - lançamento sem data, com data inexistente (20260230) ou sem valor;
 *  - valor não numérico ou ambíguo: "1.234" / "1,234" (separador de milhar ou decimal com
 *    3 casas?), "1.234.567" sem decimais, mais de 2 casas com centavos fracionados ("1,005");
 *  - TRNTYPE numérico desconhecido (2, 3...) com valor sem sinal: não dá para saber se é débito;
 *  - saldo (LEDGER) ou período (DTSTART/DTEND) presentes mas inválidos, ou DTEND < DTSTART;
 *  - mais de uma conta no mesmo arquivo (não se mistura extratos de contas diferentes).
 *
 * Valores são lidos como centavos inteiros a partir do texto, então não há erro de ponto
 * flutuante (0.1 + 0.2 não vira 0.30000000000000004).
 */

import {
  buildOfx,
  parseOfxTransactions,
  type PdfStatementResult,
} from "./pdf-to-ofx";

export interface OfcTransaction {
  date: string; // AAAA-MM-DD
  amount: number; // positivo = crédito, negativo = débito; 2 casas
  description: string;
  fitId?: string;
}

export interface OfcStatement {
  account: { bankId?: string; branchId?: string; accountId?: string };
  period?: { start: string; end: string }; // AAAA-MM-DD
  closingBalance?: number;
  transactions: OfcTransaction[];
}

/** Erro de leitura: o arquivo não é OFC ou tem conteúdo que não pode ser convertido com segurança. */
export class OfcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfcParseError";
  }
}

// ---------------------------------------------------------------- codificação

/** Decodifica o arquivo: BOM manda; sem BOM, UTF-8 se for válido, senão Windows-1252. */
function decodeText(buffer: Buffer): string {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

// ---------------------------------------------------------------- detecção

const DETECT_BYTES = 8192;

/**
 * Detecta OFC pelo conteúdo (não pela extensão): raiz `<OFC>` nos primeiros KB ou
 * cabeçalho `OFCHEADER:`. OFX (cabeçalho `OFXHEADER:`, raiz `<OFX>` ou `<?OFX`) e PDF
 * nunca são OFC.
 */
export function isOfcContent(buffer: Buffer): boolean {
  if (!buffer || !buffer.length) return false;
  const head = decodeText(buffer.subarray(0, DETECT_BYTES)).replace(/^﻿/, "");
  if (/^\s*%PDF-/.test(head)) return false;
  // Cabeçalho OFX (SGML 1.x ou XML 2.x) antes de qualquer tag
  const firstTag = head.search(/</);
  const preamble = firstTag === -1 ? head : head.slice(0, firstTag);
  if (/OFXHEADER\s*:/i.test(preamble) || /<\?OFX\b/i.test(head)) return false;
  // Vale a raiz que aparecer primeiro
  const root = head.match(/<\s*(OFC|OFX)\s*>/i);
  if (root) return root[1].toUpperCase() === "OFC";
  return /^\s*OFCHEADER\s*:/im.test(preamble);
}

// ---------------------------------------------------------------- utilidades de SGML

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

/** Valor da primeira ocorrência de `<NAME>valor` (até a próxima tag ou fim de linha). */
function tagValue(text: string, name: string): string | undefined {
  const m = text.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  if (!m) return undefined;
  const v = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return v || undefined;
}

/** Todos os valores de `<NAME>valor` no texto. */
function tagValues(text: string, name: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`<${name}>([^<\\r\\n]*)`, "gi"))) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- valores

/**
 * Lê um valor monetário como centavos inteiros. Aceita "-150.00", "150,00", "+1.234,56",
 * "1,234.56", "- 150,00", "12", ".5". Devolve null quando é inválido ou ambíguo.
 */
function parseCents(
  raw: string,
): { cents: number; explicitSign: "+" | "-" | null } | null {
  const s = raw.replace(/\s+/g, "");
  const m = s.match(/^([+-])?(\d[\d.,]*|[.,]\d+)$/);
  if (!m) return null;
  const sign = (m[1] as "+" | "-" | undefined) ?? null;
  const body = m[2];

  let intPart: string;
  let fracPart = "";
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    // Os dois separadores: o último é o decimal; o outro só pode ser milhar em grupos de 3
    const decIdx = Math.max(lastDot, lastComma);
    const thousands = decIdx === lastDot ? "," : ".";
    intPart = body.slice(0, decIdx);
    fracPart = body.slice(decIdx + 1);
    const groupRe = new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+$`);
    if (!groupRe.test(intPart)) return null;
    intPart = intPart.split(thousands).join("");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = body.split(sep);
    if (parts.length !== 2) return null; // "1.234.567": só milhar, sem decimal — ambíguo
    [intPart, fracPart] = parts;
    // Exatamente 3 dígitos depois de um único separador: milhar ou decimal? Recusa.
    if (fracPart.length === 3) return null;
  } else {
    intPart = body;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (!intPart && !fracPart) return null;
  if (fracPart.length > 2) {
    // Mais de 2 casas só se o excedente for zero (ex.: "150.0000")
    if (/[^0]/.test(fracPart.slice(2))) return null;
    fracPart = fracPart.slice(0, 2);
  }
  const cents =
    Number(intPart || "0") * 100 + Number(fracPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return { cents, explicitSign: sign };
}

const centsToAmount = (cents: number): number =>
  cents === 0 ? 0 : cents / 100;

// ---------------------------------------------------------------- datas

/** AAAAMMDD[HHMMSS[.XXX]][fuso] → AAAA-MM-DD, validando o dia no calendário. */
function parseOfcDate(raw: string): string | null {
  const m = raw
    .trim()
    .match(
      /^(\d{4})(\d{2})(\d{2})(?:\d{2}(?:\d{2}(?:\d{2}(?:\.\d{1,3})?)?)?)?\s*(?:\[[^\]]*\])?$/,
    );
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) return null;
  return `${y}-${mo}-${d}`;
}

// ---------------------------------------------------------------- tipo do lançamento

// Tipos que sempre são saída de dinheiro: valor sem sinal vira negativo
const DEBIT_TYPES = new Set([
  "1",
  "DEBIT",
  "FEE",
  "SRVCHG",
  "CHECK",
  "PAYMENT",
  "CASH",
  "DIRECTDEBIT",
  "REPEATPMT",
]);
// Tipos numéricos conhecidos (0 = crédito, 1 = débito); outros números são ambíguos
const KNOWN_NUMERIC_TYPES = new Set(["0", "1"]);

function normalizeBankId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!/^\d+$/.test(v)) return v || undefined;
  return v.replace(/^0+/, "").padStart(3, "0");
}

// ---------------------------------------------------------------- leitura

// Um lançamento vai de <STMTTRN> até o fechamento ou o início do próximo bloco
const STMTTRN_RE =
  /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/STMTRS>|<\/BANKTRANLIST>|<\/ACCTSTMT>|<\/OFC>|<LEDGER|$)/gi;

export function parseOfc(buffer: Buffer): OfcStatement {
  if (!isOfcContent(buffer)) {
    throw new OfcParseError(
      "o arquivo não é um extrato OFC (falta a raiz <OFC>; pode ser OFX, PDF ou outro formato)",
    );
  }
  let text = decodeText(buffer).replace(/^﻿/, "");
  const rootIdx = text.search(/<\s*OFC\s*>/i);
  if (rootIdx !== -1) text = text.slice(rootIdx);
  if (!/<(STMTRS|ACCTSTMT|STMTTRN)>/i.test(text)) {
    throw new OfcParseError(
      "o OFC não contém extrato (faltam <ACCTSTMT>/<STMTRS>)",
    );
  }

  // ------------------------------------------------ lançamentos
  const transactions: OfcTransaction[] = [];
  let n = 0;
  for (const m of text.matchAll(STMTTRN_RE)) {
    n++;
    const block = m[1];
    const where = `lançamento ${n}`;

    const rawDate = tagValue(block, "DTPOSTED");
    if (!rawDate) throw new OfcParseError(`${where}: sem data (DTPOSTED)`);
    const date = parseOfcDate(rawDate);
    if (!date) throw new OfcParseError(`${where}: data inválida "${rawDate}"`);

    const rawAmount = tagValue(block, "TRNAMT");
    if (!rawAmount)
      throw new OfcParseError(`${where} (${date}): sem valor (TRNAMT)`);
    const parsed = parseCents(rawAmount);
    if (!parsed)
      throw new OfcParseError(
        `${where} (${date}): valor inválido ou ambíguo "${rawAmount}"`,
      );

    const type = (tagValue(block, "TRNTYPE") || "").toUpperCase();
    let negative: boolean;
    if (parsed.explicitSign) {
      negative = parsed.explicitSign === "-";
    } else if (
      /^\d+$/.test(type) &&
      !KNOWN_NUMERIC_TYPES.has(type) &&
      parsed.cents !== 0
    ) {
      throw new OfcParseError(
        `${where} (${date}): TRNTYPE ${type} desconhecido com valor sem sinal "${rawAmount}" — não dá para saber se é crédito ou débito`,
      );
    } else {
      negative = DEBIT_TYPES.has(type);
    }
    const amount = centsToAmount(negative ? -parsed.cents : parsed.cents);

    const memo = tagValue(block, "MEMO");
    const name = tagValue(block, "NAME");
    let description: string;
    if (memo && name && memo.toUpperCase() !== name.toUpperCase())
      description = `${memo} - ${name}`;
    else description = memo || name || "Lançamento";

    const fitId = tagValue(block, "FITID");
    transactions.push({
      date,
      amount,
      description: description.slice(0, 250),
      ...(fitId ? { fitId } : {}),
    });
  }

  // ------------------------------------------------ cabeçalho do extrato (sem os lançamentos,
  // para não pegar BANKID/ACCTID de contas de destino dentro de um STMTTRN)
  const rest = text.replace(STMTTRN_RE, "");

  const accountIds = new Set(
    tagValues(rest, "ACCTID").map((v) => v.replace(/^0+(?=\d)/, "")),
  );
  if (accountIds.size > 1) {
    throw new OfcParseError(
      `o OFC traz mais de uma conta (${[...accountIds].join(", ")}); envie um arquivo por conta`,
    );
  }
  const account: OfcStatement["account"] = {};
  const bankId = normalizeBankId(tagValue(rest, "BANKID"));
  const branchId = tagValue(rest, "BRANCHID");
  const accountId = tagValue(rest, "ACCTID");
  if (bankId) account.bankId = bankId;
  if (branchId) account.branchId = branchId;
  if (accountId) account.accountId = accountId;

  // ------------------------------------------------ período
  const rawStart = tagValue(rest, "DTSTART");
  const rawEnd = tagValue(rest, "DTEND");
  let period: OfcStatement["period"];
  if (rawStart || rawEnd) {
    const start = rawStart ? parseOfcDate(rawStart) : null;
    const end = rawEnd ? parseOfcDate(rawEnd) : null;
    if (rawStart && !start)
      throw new OfcParseError(`DTSTART inválido "${rawStart}"`);
    if (rawEnd && !end) throw new OfcParseError(`DTEND inválido "${rawEnd}"`);
    if (start && end) {
      if (end < start)
        throw new OfcParseError(
          `período invertido: DTSTART ${start} depois de DTEND ${end}`,
        );
      period = { start, end };
    }
  }

  // ------------------------------------------------ saldo: <LEDGER>valor ou <LEDGERBAL><BALAMT>valor
  let closingBalance: number | undefined;
  const ledgerBal = rest.match(
    /<LEDGERBAL>([\s\S]*?)(?=<\/LEDGERBAL>|<\/STMTRS>|<\/ACCTSTMT>|<\/OFC>|$)/i,
  );
  const rawLedger = ledgerBal
    ? tagValue(ledgerBal[1], "BALAMT")
    : tagValue(rest, "LEDGER");
  if (rawLedger) {
    const parsed = parseCents(rawLedger);
    if (!parsed)
      throw new OfcParseError(
        `saldo (LEDGER) inválido ou ambíguo "${rawLedger}"`,
      );
    closingBalance = centsToAmount(
      parsed.explicitSign === "-" ? -parsed.cents : parsed.cents,
    );
  }

  return {
    account,
    ...(period ? { period } : {}),
    ...(closingBalance !== undefined ? { closingBalance } : {}),
    transactions,
  };
}

// ---------------------------------------------------------------- competência

/**
 * Competência AAAA-MM predominante: a com mais lançamentos; empate → a mais recente.
 * Null quando não há lançamentos com data válida.
 */
export function competenceFromTransactions(
  transactions: { date: string }[],
): string | null {
  const counts = new Map<string, number>();
  for (const t of transactions) {
    const m = /^(\d{4})-(\d{2})-\d{2}/.exec(t?.date || "");
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) continue;
    const key = `${m[1]}-${m[2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount && best !== null && key > best)
    ) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

// ---------------------------------------------------------------- conversão para OFX

/** Primeira data AAAAMMDD válida de uma tag do cabeçalho (usada como período de extrato sem movimento). */
function fallbackDate(buffer: Buffer): string | null {
  const text = decodeText(buffer);
  for (const name of ["DTASOF", "DTSERVER"]) {
    const v = tagValue(text, name);
    const d = v ? parseOfcDate(v) : null;
    if (d) return d;
  }
  return null;
}

/**
 * Converte OFC em OFX 1.02 (via buildOfx). O período é o DTSTART/DTEND do OFC, ampliado
 * se algum lançamento cair fora dele; na falta, vai da menor à maior data dos lançamentos.
 * O OFX gerado é relido e conferido (datas e valores) antes de ser devolvido.
 */
export function ofcToOfx(
  buffer: Buffer,
  opts: { fitIdPrefix: string },
): { ofx: Buffer; statement: OfcStatement } {
  const statement = parseOfc(buffer);
  const dates = statement.transactions.map((t) => t.date).sort();
  let start = statement.period?.start;
  let end = statement.period?.end;
  if (dates.length) {
    if (!start || dates[0] < start) start = dates[0];
    if (!end || dates[dates.length - 1] > end) end = dates[dates.length - 1];
  }
  if (!start || !end) {
    // Sem movimento e sem período: usa a data do saldo ou do servidor
    const d = fallbackDate(buffer);
    if (!d)
      throw new OfcParseError(
        "OFC sem lançamentos e sem período (DTSTART/DTEND): não há como datar o OFX",
      );
    start = start || d;
    end = end || d;
    if (end < start) [start, end] = [end, start];
  }

  const result: PdfStatementResult = {
    ok: true,
    transactions: statement.transactions.map((t) => ({
      date: t.date,
      amount: t.amount,
      description: t.description,
    })),
    checkpoints: { passed: 0, failed: 0, details: [] },
    period: { start, end },
    account: { ...statement.account },
  };
  if (statement.closingBalance !== undefined)
    result.closingBalance = statement.closingBalance;
  const ofx = buildOfx(result, opts);

  // Conferência: o OFX relido tem de trazer exatamente os mesmos lançamentos
  const back = parseOfxTransactions(ofx);
  const same =
    back.length === statement.transactions.length &&
    back.every(
      (t, i) =>
        t.date === statement.transactions[i].date &&
        t.amount === statement.transactions[i].amount,
    );
  if (!same)
    throw new OfcParseError(
      "o OFX gerado não confere com os lançamentos do OFC",
    );

  return { ofx, statement };
}
