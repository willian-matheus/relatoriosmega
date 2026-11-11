/**
 * Motor de deduplicação do envio de extratos (funções puras, sem banco nem rede).
 *
 * Garante que um mesmo extrato não chegue duas vezes ao destino, seja:
 *  - o mesmo arquivo enviado duas vezes pelo cliente (conteúdo idêntico);
 *  - o OFX e o PDF do mesmo extrato (só vai um: OFX do cliente > OFX convertido > PDF);
 *  - um extrato que o destino já tem (veio por outro caminho, ex.: SCI Web);
 *  - um extrato que já foi enviado antes.
 *
 * "Mesmo extrato" = mesma empresa, mesma competência e mesma conta (quando a conta é
 * conhecida dos dois lados) e lançamentos que se sobrepõem. Na dúvida, NÃO envia:
 * a regra de negócio é que duplicidade é pior do que um envio a menos.
 */

export interface StatementTx {
  date: string; // AAAA-MM-DD
  amount: number; // positivo = crédito, negativo = débito
}

export interface AccountRef {
  bankCode?: string | null;
  number?: string | null;
}

/** Arquivo do relatoriosmega candidato ao envio (ou já enviado). */
export interface LocalStatement {
  id: string;
  companyKey: string; // identifica a empresa no relatoriosmega (código do Gestta ou CNPJ)
  competence: string | null; // AAAA-MM
  format: "ofx" | "pdf";
  converted: boolean; // OFX gerado a partir de PDF
  sha256: string;
  fileName: string;
  uploadedAt?: string | null;
  account: AccountRef | null;
  /** null = não foi possível ler os lançamentos (ex.: PDF que o conversor recusou) */
  transactions: StatementTx[] | null;
  /** já foi enviado ao destino em execução anterior */
  alreadySent?: boolean;
}

/** Extrato que já existe no destino. */
export interface DestinationStatement {
  id: string;
  name: string;
  companyKey: string; // mesma chave da empresa usada nos arquivos locais
  account: AccountRef | null;
  transactions: StatementTx[]; // vazio = extrato sem movimento
}

export type DeliveryDecision =
  | { id: string; action: "send" }
  | { id: string; action: "skip"; reason: string; duplicateOf?: string };

/** Fração mínima de lançamentos em comum (sobre o menor extrato) para considerar o mesmo extrato. */
export const OVERLAP_THRESHOLD = 0.5;

// ------------------------------------------------------------------ contas

export function normalizeBankCode(code?: string | null): string | null {
  if (!code) return null;
  const digits = String(code).trim();
  // códigos não numéricos (ex.: "sciweb:xyz") não servem para comparar banco
  if (!/^\d{1,4}$/.test(digits)) return null;
  return digits.padStart(3, "0").slice(-3);
}

export function normalizeAccountNumber(n?: string | null): string | null {
  if (!n) return null;
  const digits = String(n).replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 3 ? digits : null;
}

/**
 * true = mesma conta | false = contas diferentes | null = não dá para saber.
 * Tolera dígito verificador presente de um lado só e zeros à esquerda.
 */
export function compareAccounts(a: AccountRef | null, b: AccountRef | null): boolean | null {
  const bankA = normalizeBankCode(a?.bankCode);
  const bankB = normalizeBankCode(b?.bankCode);
  if (bankA && bankB && bankA !== bankB) return false;

  const na = normalizeAccountNumber(a?.number);
  const nb = normalizeAccountNumber(b?.number);
  if (!na || !nb) return null;
  if (na === nb) return true;
  const [long, short] = na.length >= nb.length ? [na, nb] : [nb, na];
  // um lado com dígito verificador e o outro sem
  if (long.length === short.length + 1 && long.startsWith(short)) return true;
  // contas longas (ex.: PagSeguro/Mercado Pago) às vezes vêm com prefixo de agência
  if (short.length >= 6 && long.endsWith(short)) return true;
  return false;
}

// ------------------------------------------------------------------ lançamentos

const txKey = (t: StatementTx) => `${t.date}|${Math.round(t.amount * 100)}`;

/** Lançamentos em comum (multiconjunto: data + valor com sinal) / tamanho do menor. */
export function transactionOverlap(a: StatementTx[], b: StatementTx[]): number {
  if (!a.length || !b.length) return 0;
  const pool = new Map<string, number>();
  for (const t of b) pool.set(txKey(t), (pool.get(txKey(t)) || 0) + 1);
  let common = 0;
  for (const t of a) {
    const k = txKey(t);
    const n = pool.get(k) || 0;
    if (n > 0) {
      common++;
      pool.set(k, n - 1);
    }
  }
  return common / Math.min(a.length, b.length);
}

interface Comparable {
  account: AccountRef | null;
  transactions: StatementTx[] | null;
}

/**
 * Decide se dois extratos (da mesma empresa e competência) são o mesmo.
 * Retorna o motivo quando são, ou null quando são diferentes.
 */
export function sameStatementReason(a: Comparable, b: Comparable): string | null {
  const accounts = compareAccounts(a.account, b.account);
  if (accounts === false) return null; // contas diferentes: extratos diferentes

  const ta = a.transactions;
  const tb = b.transactions;
  const bothReadable = ta !== null && tb !== null && ta.length > 0 && tb.length > 0;

  if (bothReadable) {
    const overlap = transactionOverlap(ta!, tb!);
    if (overlap >= OVERLAP_THRESHOLD) {
      return `${Math.round(overlap * 100)}% dos lançamentos são iguais`;
    }
    // lançamentos diferentes: outro período ou outra conta
    return null;
  }

  // Sem lançamentos para comparar de um dos lados (PDF ilegível, extrato sem movimento)
  if (accounts === true) return "mesma conta e competência";
  // conta desconhecida de algum lado: na dúvida, considera o mesmo (evita duplicidade)
  return "mesma empresa e competência, sem como confirmar que é outra conta";
}

// ------------------------------------------------------------------ plano de envio

/** Prioridade de quem representa um extrato: OFX do cliente > OFX convertido > PDF. */
export function priorityOf(s: LocalStatement): number {
  if (s.format === "ofx" && !s.converted) return 0;
  if (s.format === "ofx") return 1;
  return 2;
}

function byPriority(a: LocalStatement, b: LocalStatement): number {
  return (
    priorityOf(a) - priorityOf(b) ||
    String(a.uploadedAt || "").localeCompare(String(b.uploadedAt || "")) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Monta o plano de envio de todos os arquivos pendentes.
 *
 * @param local       arquivos do relatoriosmega das empresas/competências envolvidas,
 *                    incluindo os já enviados (alreadySent) para servirem de referência
 * @param destination extratos que o destino já tem, por empresa (companyKey)
 * @param competenceOfDestination competência de um extrato do destino
 */
export function planDeliveries(
  local: LocalStatement[],
  destination: DestinationStatement[],
  competenceOfDestination: (d: DestinationStatement) => string[],
): DeliveryDecision[] {
  const decisions: DeliveryDecision[] = [];

  const groups = new Map<string, LocalStatement[]>();
  for (const s of local) {
    const key = `${s.companyKey}|${s.competence || "?"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  for (const [key, files] of groups) {
    const [companyKey, competence] = key.split("|");
    const destInGroup = destination.filter(
      (d) => d.companyKey === companyKey && competence !== "?" && competenceOfDestination(d).includes(competence),
    );

    // Referências: o que já está no destino + o que já foi enviado + o que for escolhido agora
    const kept: LocalStatement[] = files.filter((f) => f.alreadySent);
    const pending = files.filter((f) => !f.alreadySent).sort(byPriority);

    for (const file of pending) {
      if (file.competence === null) {
        decisions.push({ id: file.id, action: "skip", reason: "competência desconhecida; não é possível garantir que não duplica" });
        continue;
      }

      // 1. Arquivo idêntico (mesmo conteúdo) a um já escolhido ou já enviado
      const identical = kept.find((k) => k.sha256 === file.sha256);
      if (identical) {
        decisions.push({
          id: file.id,
          action: "skip",
          reason: `arquivo idêntico a "${identical.fileName}"${identical.alreadySent ? " (já enviado)" : ""}`,
          duplicateOf: identical.id,
        });
        continue;
      }

      // 2. O destino já tem este extrato
      let skipped = false;
      for (const d of destInGroup) {
        const reason = sameStatementReason(file, d);
        if (reason) {
          decisions.push({ id: file.id, action: "skip", reason: `o destino já tem este extrato ("${d.name}"): ${reason}`, duplicateOf: d.id });
          skipped = true;
          break;
        }
      }
      if (skipped) continue;

      // 3. Mesmo extrato que outro arquivo já escolhido/enviado (ex.: OFX e PDF da mesma conta)
      for (const k of kept) {
        const reason = sameStatementReason(file, k);
        if (reason) {
          decisions.push({
            id: file.id,
            action: "skip",
            reason: `mesmo extrato que "${k.fileName}" (${k.format.toUpperCase()}${k.converted ? " convertido" : ""}${k.alreadySent ? ", já enviado" : ""}): ${reason}`,
            duplicateOf: k.id,
          });
          skipped = true;
          break;
        }
      }
      if (skipped) continue;

      kept.push(file);
      decisions.push({ id: file.id, action: "send" });
    }
  }

  return decisions;
}
