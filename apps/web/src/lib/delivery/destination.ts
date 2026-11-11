import { Pool } from "pg";
import type { DestinationStatement, StatementTx } from "./dedupe";

/**
 * Leitura do que o destino (CRM-MEGA) já tem, para não enviar extratos duplicados.
 *
 * A API do destino não permite consulta com token externo, então a leitura é feita
 * direto no banco dele com um usuário SOMENTE LEITURA (EXTRATOS_DATABASE_URL), que só
 * enxerga as tabelas Company, Bank, BankAccount, Statement e Transaction.
 */

export class DestinationUnavailableError extends Error {}

export interface LocalCompanyRef {
  companyKey: string;
  code: string | null;
  name: string;
  cnpj: string | null;
}

export interface DestinationIndex {
  /** companyKey local -> id da empresa no destino (null = não encontrada) */
  companies: Map<string, string | null>;
  statements: DestinationStatement[];
  competenceOf: (d: DestinationStatement) => string[];
}

let pool: Pool | null = null;
function getPool(): Pool {
  const url = process.env.EXTRATOS_DATABASE_URL;
  if (!url) {
    throw new DestinationUnavailableError(
      "EXTRATOS_DATABASE_URL não configurada: sem como verificar o que o destino já tem, o envio fica bloqueado para não duplicar extratos.",
    );
  }
  if (!pool) {
    pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2, idleTimeoutMillis: 10_000 });
  }
  return pool;
}

export function normalizeName(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(ltda|me|epp|eireli|s\/?a|sa)\b/gi, " ")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
}

const digits = (s: string | null | undefined) => (s || "").replace(/\D/g, "");

/**
 * Casa a empresa local com a do destino. Exige confirmação por dois sinais quando
 * o código coincide (códigos podem se repetir entre sistemas) e aceita nome ou CNPJ.
 */
export function matchCompany(
  local: LocalCompanyRef,
  candidates: { id: string; name: string; externalId: string | null; document: string | null }[],
): string | null {
  const name = normalizeName(local.name);
  const cnpj = digits(local.cnpj);
  const byCnpj = cnpj.length >= 11 ? candidates.filter((c) => digits(c.document) === cnpj) : [];
  if (byCnpj.length === 1) return byCnpj[0].id;
  const byName = candidates.filter((c) => normalizeName(c.name) === name && name.length > 0);
  const byCode = local.code ? candidates.filter((c) => String(c.externalId || "") === String(local.code)) : [];
  const both = byName.filter((c) => byCode.some((k) => k.id === c.id));
  if (both.length === 1) return both[0].id;
  if (byName.length === 1) return byName[0].id;
  return null; // ambíguo ou não encontrado: não arrisca
}

/** Competências cobertas por um extrato do destino (pelos lançamentos ou, se vazio, pelo nome). */
export function destinationCompetences(d: DestinationStatement): string[] {
  const months = new Set(d.transactions.map((t) => t.date.slice(0, 7)));
  if (!months.size) {
    for (const m of d.name.matchAll(/\b(0[1-9]|1[0-2])\s*\/\s*(\d{4})\b/g)) months.add(`${m[2]}-${m[1]}`);
  }
  return [...months];
}

function monthBounds(competences: string[]): { from: string; to: string } {
  const sorted = [...competences].sort();
  const [fy, fm] = sorted[0].split("-").map(Number);
  const [ty, tm] = sorted[sorted.length - 1].split("-").map(Number);
  // margem de um mês para extratos que começam no último dia do mês anterior
  const from = new Date(Date.UTC(fy, fm - 2, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(ty, tm + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export async function loadDestinationIndex(
  companies: LocalCompanyRef[],
  competences: string[],
): Promise<DestinationIndex> {
  const db = getPool();
  const all = (
    await db.query<{ id: string; name: string; externalId: string | null; document: string | null }>(
      `select id, name, "externalId", document from "Company"`,
    )
  ).rows;

  const map = new Map<string, string | null>();
  for (const c of companies) map.set(c.companyKey, matchCompany(c, all));
  const destIds = [...new Set([...map.values()].filter((v): v is string => Boolean(v)))];
  // Uma empresa do destino pode corresponder a mais de uma chave local
  const keysByDestId = new Map<string, string[]>();
  for (const [k, v] of map) if (v) keysByDestId.set(v, [...(keysByDestId.get(v) || []), k]);

  if (!destIds.length || !competences.length) {
    return { companies: map, statements: [], competenceOf: destinationCompetences };
  }

  const { from, to } = monthBounds(competences);
  const stmts = (
    await db.query<{ id: string; name: string; companyId: string; bank_code: string | null; acct: string | null }>(
      `select s.id, s.name, s."companyId", b.code as bank_code, ba.number as acct
         from "Statement" s
         left join "BankAccount" ba on ba.id = s."bankAccountId"
         left join "Bank" b on b.id = ba."bankId"
        where s."companyId" = any($1)`,
      [destIds],
    )
  ).rows;

  const txs = stmts.length
    ? (
        await db.query<{ statementId: string; d: string; amount: number; type: string }>(
          `select t."statementId", to_char(t.date, 'YYYY-MM-DD') as d, t.amount, t.type
             from "Transaction" t
            where t."statementId" = any($1) and t.date >= $2::date and t.date < ($3::date + interval '1 day')`,
          [stmts.map((s) => s.id), from, to],
        )
      ).rows
    : [];

  const txByStatement = new Map<string, StatementTx[]>();
  for (const t of txs) {
    const list = txByStatement.get(t.statementId) || [];
    const value = Math.abs(Number(t.amount));
    list.push({ date: t.d, amount: t.type === "debit" ? -value : value });
    txByStatement.set(t.statementId, list);
  }

  const statements: DestinationStatement[] = stmts.flatMap((s) =>
    (keysByDestId.get(s.companyId) || []).map((companyKey) => ({
      id: s.id,
      name: s.name,
      companyKey,
      account: { bankCode: s.bank_code, number: s.acct },
      transactions: txByStatement.get(s.id) || [],
    })),
  );

  // Só interessam os extratos com alguma competência pedida
  const wanted = new Set(competences);
  return {
    companies: map,
    statements: statements.filter((d) => destinationCompetences(d).some((m) => wanted.has(m))),
    competenceOf: destinationCompetences,
  };
}
