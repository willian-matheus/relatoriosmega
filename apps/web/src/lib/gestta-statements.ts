import {
  getGesttaCustomers,
  downloadGesttaRequestedFile,
  getGesttaTaskDetailWithRetry,
  searchGesttaTasksPage,
} from "./gestta";
import {
  getCapturedStatements,
  getStatementContent,
  saveStatementFromGesttaDocument,
  setStatementDriveFile,
  StatementFile,
} from "./statements";
import { getAuthenticatedDriveClient, findOrCreateFolder, uploadFileToFolder } from "./google";
import { sanitizeFolderName } from "./gestta-sync";
import { CONVERTED_SUFFIX, convertOfcStatement, convertPdfStatement } from "./statement-conversions";
import {
  mapTaskDetailToDocumentRequests,
  mapTaskDocToRow,
  saveDocumentRequests,
  saveTaskSnapshot,
  type GesttaDocumentRequestRow,
  type GesttaTaskRow,
  type SnapshotWriteResult,
} from "./dashboard/snapshot";

/**
 * Captura de extratos bancários enviados pelos clientes no Gestta.
 *
 * No Gestta, os extratos chegam pelas tarefas "Envio de Extratos Bancários e Documentos
 * Contábeis": cada tarefa tem uma solicitação de documentos
 * (`document_request.requested_documents`) com itens como "Extratos de Conta Corrente
 * (em .OFX e em .PDF)", e o cliente anexa os arquivos em cada item.
 */

// Tarefas que recebem extratos (o nome pode vir seguido de " - EMPRESA")
const STATEMENT_TASK_NAME = /^envio de extratos banc[aá]rios/i;
// Itens da solicitação que são extratos; "Demais Documentos" fica de fora
const STATEMENT_REQUESTED_DOC = /^extratos?\b/i;
// Item de conta corrente: único em que o OFX faz sentido (e é pedido ao cliente)
const CHECKING_ACCOUNT_DOC = /conta\s+corrente/i;

const DETAIL_CONCURRENCY = 4;

// Pasta raiz PRIVADA no Drive. Não usa "Mega Contabilidade - Gestta", que a sincronização
// compartilha com "qualquer pessoa com o link".
const DEFAULT_DRIVE_ROOT = "Mega Contabilidade - Extratos";
const MAX_TASK_PAGES = 200;

export interface StatementSyncOptions {
  /** Início da janela de vencimento das tarefas (ISO). Padrão: 90 dias atrás. */
  startDate?: string;
  /** Fim da janela de vencimento das tarefas (ISO). Padrão: 45 dias à frente. */
  endDate?: string;
  /** Limite de tarefas de extrato processadas (útil para testes). */
  maxTasks?: number;
}

export interface StatementSyncSummary {
  startedAt: string;
  finishedAt: string;
  period: { start: string; end: string };
  tasksScanned: number;
  statementTasks: number;
  filesFound: number;
  saved: number;
  savedOfx: number;
  savedPdf: number;
  savedOfc: number;
  alreadyCaptured: number;
  drive: {
    connected: boolean;
    rootFolder?: string;
    rootFolderUrl?: string;
    uploaded: number;
    /** Extratos capturados antes (sem cópia no Drive) enviados agora */
    backfilled: number;
    errors: { fileName: string; message: string }[];
  };
  /** Regra: cliente enviou só PDF de conta corrente -> OFX gerado a partir do PDF */
  conversions: {
    converted: number;
    alreadyConverted: number;
    failed: { fileName: string; reason: string }[];
  };
  ignored: { fileName: string; reason: string }[];
  errors: { taskId: string; fileName?: string; message: string }[];
  /** Retrato para o Painel (gestta_tasks / gestta_document_requests); falhas não afetam a captura */
  snapshot: {
    tasks: SnapshotWriteResult;
    documentRequests: SnapshotWriteResult;
  };
}

function emptySnapshotResult(): SnapshotWriteResult {
  return { enabled: false, attempted: 0, written: 0, batches: 0, errors: [] };
}

/** Painel: grava o retrato sem nunca lançar (a captura de extratos não pode ser afetada). */
async function safeSnapshotWrite(
  write: () => Promise<SnapshotWriteResult>,
): Promise<SnapshotWriteResult> {
  try {
    return await write();
  } catch (err: any) {
    return { ...emptySnapshotResult(), errors: [err?.message || String(err)] };
  }
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function competenceOf(task: any): string | undefined {
  const raw = task.competence_date || task.competence || task.due_date;
  return typeof raw === "string" && /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : undefined;
}

/** Mapa id do cliente no Gestta -> CNPJ/CPF (apenas dígitos, como o Gestta guarda). */
async function loadCustomerDocuments(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const first = await getGesttaCustomers({ page: 1, limit: 100 });
  const all = [...first.customers];
  for (let page = 2; page <= first.pages; page++) {
    all.push(...(await getGesttaCustomers({ page, limit: 100 })).customers);
  }
  for (const c of all) if (c.id && c.cnpj) map.set(c.id, c.cnpj);
  return map;
}

type DriveClient = NonNullable<Awaited<ReturnType<typeof getAuthenticatedDriveClient>>>["drive"];

/**
 * Prepara o envio ao Drive: Raiz / Empresa / Competência AAAA-MM / arquivo.
 * Retorna null (e registra o motivo) quando o Drive não está disponível.
 */
async function createDriveUploader(summary: StatementSyncSummary) {
  let driveClient: DriveClient;
  try {
    const client = await getAuthenticatedDriveClient("default_user");
    if (!client?.drive) return null;
    driveClient = client.drive;
  } catch (err: any) {
    // Sem Supabase/Google configurado: segue sem Drive
    console.warn("[Extratos] Google Drive indisponível:", err?.message || err);
    return null;
  }

  const rootName = process.env.GOOGLE_DRIVE_STATEMENTS_FOLDER || DEFAULT_DRIVE_ROOT;
  return buildDriveUploader(driveClient, rootName, summary);
}

/** Exportada para testes (recebe o cliente do Drive já autenticado). */
export async function buildDriveUploader(
  driveClient: DriveClient,
  rootName: string,
  summary: StatementSyncSummary,
) {
  let rootId: string;
  try {
    rootId = await findOrCreateFolder(driveClient, rootName);
  } catch (err: any) {
    summary.drive.errors.push({ fileName: rootName, message: err?.message || String(err) });
    return null;
  }
  summary.drive.connected = true;
  summary.drive.rootFolder = rootName;
  summary.drive.rootFolderUrl = `https://drive.google.com/drive/folders/${rootId}`;

  // Cache por caminho: tarefas processadas em paralelo não criam pastas duplicadas
  const folders = new Map<string, Promise<string>>();
  const folder = (path: string[]): Promise<string> => {
    const key = path.join("/");
    let pending = folders.get(key);
    if (!pending) {
      pending = (path.length === 1
        ? Promise.resolve(rootId)
        : folder(path.slice(0, -1))
      ).then((parentId) =>
        path.length === 1 ? parentId : findOrCreateFolder(driveClient, path[path.length - 1], parentId),
      );
      pending.catch(() => folders.delete(key));
      folders.set(key, pending);
    }
    return pending;
  };

  return {
    async upload(statement: StatementFile, buffer: Buffer) {
      const parentId = await folder([
        rootName,
        sanitizeFolderName(statement.companyName) || "Empresa não identificada",
        `Competência ${statement.competence || "Sem competência"}`,
      ]);
      // Sufixo com o id do Gestta: dois extratos com o mesmo nome não se sobrescrevem
      const dot = statement.fileName.lastIndexOf(".");
      const base = dot > 0 ? statement.fileName.slice(0, dot) : statement.fileName;
      const ext = dot > 0 ? statement.fileName.slice(dot) : "";
      // Convertidos usam o sufixo do PDF de origem (o id termina com "-convertido-ofx")
      const shortId = statement.gesttaDocumentId.replace(CONVERTED_SUFFIX, "").slice(-6);
      const uploaded = await uploadFileToFolder(driveClient, {
        fileName: `${base} [${shortId}]${ext}`,
        mimeType: statement.contentType,
        content: buffer,
        parentId,
        description: statement.conversionNote || undefined,
      });
      return { fileId: uploaded.id, link: uploaded.webViewLink || null };
    },
  };
}

// Mantido aqui por compatibilidade: a nota agora mora em statement-conversions.ts
export { buildConversionNote } from "./statement-conversions";

/**
 * Cópia avulsa de um extrato no Drive (usada pelo recebimento via API).
 * Retorna null quando o Drive não está conectado; erros de envio são lançados.
 */
export async function copyStatementToDrive(
  statement: StatementFile,
  buffer: Buffer,
): Promise<{ fileId: string; link: string | null } | null> {
  const summary = {
    drive: { connected: false, uploaded: 0, backfilled: 0, errors: [] as { fileName: string; message: string }[] },
  } as StatementSyncSummary;
  const uploader = await createDriveUploader(summary);
  if (!uploader) return null;
  const uploaded = await uploader.upload(statement, buffer);
  await setStatementDriveFile(statement.id, uploaded);
  return uploaded;
}

/** Gera e guarda o OFX de cada PDF de conta corrente / OFC que ainda não foi convertido. */
async function convertCheckingPdfs(
  pdfs: { id: string; buffer?: Buffer }[],
  summary: StatementSyncSummary,
  copyToDrive: (s: StatementFile, b: Buffer, backfill: boolean) => Promise<void>,
): Promise<void> {
  for (const item of pdfs) {
    let pdfName = item.id;
    try {
      const content = await getStatementContent(item.id);
      if (!content) continue;
      pdfName = content.file.fileName;
      const convert = content.file.format === "ofc" ? convertOfcStatement : convertPdfStatement;
      const result = await convert(content.file, item.buffer || content.buffer);
      if (!result.ok) {
        summary.conversions.failed.push({ fileName: content.file.fileName, reason: result.reason });
        continue;
      }
      if (result.already) {
        summary.conversions.alreadyConverted++;
        if (!result.driveFileId) {
          const conv = await getStatementContent(result.convertedId);
          if (conv) await copyToDrive(conv.file, conv.buffer, true);
        }
        continue;
      }
      summary.conversions.converted++;
      await copyToDrive(result.saved, result.ofx, false);
    } catch (err) {
      summary.conversions.failed.push({ fileName: pdfName, reason: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function syncGesttaStatements(
  options: StatementSyncOptions = {},
): Promise<StatementSyncSummary> {
  const startedAt = new Date().toISOString();
  const start = options.startDate || isoDaysFromNow(-90);
  const end = options.endDate || isoDaysFromNow(45);

  const summary: StatementSyncSummary = {
    startedAt,
    finishedAt: startedAt,
    period: { start, end },
    tasksScanned: 0,
    statementTasks: 0,
    filesFound: 0,
    saved: 0,
    savedOfx: 0,
    savedPdf: 0,
    savedOfc: 0,
    alreadyCaptured: 0,
    drive: { connected: false, uploaded: 0, backfilled: 0, errors: [] },
    conversions: { converted: 0, alreadyConverted: 0, failed: [] },
    ignored: [],
    errors: [],
    snapshot: { tasks: emptySnapshotResult(), documentRequests: emptySnapshotResult() },
  };

  // 1. Varre as tarefas da janela e separa as de envio de extratos
  const statementTasks: any[] = [];
  const snapshotRows: GesttaTaskRow[] = []; // Painel: retrato de todas as tarefas varridas
  for (let page = 1; page <= MAX_TASK_PAGES; page++) {
    const { docs, pages } = await searchGesttaTasksPage({
      startDate: start,
      endDate: end,
      page,
      limit: 100,
    });
    summary.tasksScanned += docs.length;
    for (const doc of docs) {
      try {
        const row = mapTaskDocToRow(doc, startedAt);
        if (row) snapshotRows.push(row);
      } catch {
        // documento malformado: fica fora do retrato, a captura segue
      }
    }
    statementTasks.push(...docs.filter((t) => STATEMENT_TASK_NAME.test(t.name || "")));
    if (!docs.length || page >= pages) break;
  }
  // Painel: grava o retrato das tarefas ao fim da varredura (falha não interrompe a captura)
  summary.snapshot.tasks = await safeSnapshotWrite(() => saveTaskSnapshot(snapshotRows));

  const selected = options.maxTasks ? statementTasks.slice(0, options.maxTasks) : statementTasks;
  summary.statementTasks = selected.length;

  // O cliente que vem na tarefa não traz CNPJ; a listagem de clientes traz
  const documentByCustomer = selected.length ? await loadCustomerDocuments() : new Map();

  // Cópia no Google Drive (opcional: sem Drive conectado, a captura segue normalmente)
  const drive = selected.length ? await createDriveUploader(summary) : null;
  const copyToDrive = async (statement: StatementFile, buffer: Buffer, backfill: boolean) => {
    if (!drive) return;
    try {
      const uploaded = await drive.upload(statement, buffer);
      await setStatementDriveFile(statement.id, uploaded);
      if (backfill) summary.drive.backfilled++;
      else summary.drive.uploaded++;
    } catch (err: any) {
      summary.drive.errors.push({ fileName: statement.fileName, message: err?.message || String(err) });
    }
  };

  // Painel: itens de solicitação de documentos, gravados de uma vez ao fim da etapa 2
  const documentRequestRows: GesttaDocumentRequestRow[] = [];

  // 2. Para cada tarefa, lê os arquivos enviados e captura os extratos novos
  await mapWithConcurrency(selected, DETAIL_CONCURRENCY, async (listed) => {
    let task: any;
    try {
      task = await getGesttaTaskDetailWithRetry(listed._id);
    } catch (err: any) {
      summary.errors.push({ taskId: listed._id, message: err?.message || String(err) });
      return;
    }

    try {
      documentRequestRows.push(...mapTaskDetailToDocumentRequests(task, listed, startedAt));
    } catch {
      // detalhe malformado: fica fora do painel, a captura segue
    }

    const customer = task.customer || listed.customer || {};
    const customerId = customer._id || customer.id;
    const requested: any[] = (task.document_request?.requested_documents || []).filter(
      (doc: any) => STATEMENT_REQUESTED_DOC.test(doc.name || "") && !doc.disconsidered,
    );
    const files = requested.flatMap((doc) =>
      (doc.files || []).map((file: any) => ({ doc, file })),
    );
    if (!files.length) return;
    summary.filesFound += files.length;

    let existing: Map<string, { id: string; driveFileId: string | null }>;
    try {
      existing = await getCapturedStatements(files.map((f) => String(f.file._id)));
    } catch (err: any) {
      summary.errors.push({ taskId: task._id, message: err?.message || String(err) });
      return;
    }

    // Regra de conversão: PDFs de conta corrente desta tarefa e se o cliente mandou algum OFX
    const checkingFiles = files.filter((f) => CHECKING_ACCOUNT_DOC.test(f.doc.name || ""));
    const clientSentOfx = checkingFiles.some((f) => /\.(ofx|qfx)$/i.test(String(f.file.file_name || "")));
    const checkingPdfs: { id: string; buffer?: Buffer }[] = [];
    // OFC é sempre convertido para OFX (dados estruturados, sem ambiguidade de leitura)
    const ofcFiles: { id: string; buffer?: Buffer }[] = [];
    const isCheckingPdf = (doc: any, fileName: string) =>
      CHECKING_ACCOUNT_DOC.test(doc.name || "") && /\.pdf$/i.test(fileName);
    const isOfc = (fileName: string) => /\.ofc$/i.test(fileName);

    for (const { doc, file } of files) {
      const fileId = String(file._id);
      const fileName = String(file.file_name || `arquivo_${fileId}`);
      const captured = existing.get(fileId);
      if (captured) {
        summary.alreadyCaptured++;
        if (isCheckingPdf(doc, fileName)) checkingPdfs.push({ id: captured.id });
        if (isOfc(fileName)) ofcFiles.push({ id: captured.id });
        // Capturado quando o Drive não estava conectado: envia a cópia agora
        if (drive && !captured.driveFileId) {
          try {
            const content = await getStatementContent(captured.id);
            if (content) await copyToDrive(content.file, content.buffer, true);
          } catch (err: any) {
            summary.drive.errors.push({ fileName, message: err?.message || String(err) });
          }
        }
        continue;
      }
      if (!/\.(ofx|qfx|pdf|ofc)$/i.test(fileName) && /\.[a-z0-9]{2,5}$/i.test(fileName)) {
        summary.ignored.push({ fileName, reason: "formato não suportado (apenas OFX, PDF e OFC)" });
        continue;
      }
      if (!customerId) {
        summary.errors.push({ taskId: task._id, fileName, message: "tarefa sem cliente" });
        continue;
      }

      try {
        const downloaded = await downloadGesttaRequestedFile({
          customerTaskId: task._id,
          requestedDocumentId: doc._id,
          customerId,
          fileId,
        });
        if (!downloaded) {
          summary.errors.push({ taskId: task._id, fileName, message: "download falhou" });
          continue;
        }

        const saved = await saveStatementFromGesttaDocument({
          documentId: fileId,
          fileName,
          buffer: downloaded.buffer,
          task: {
            id: task._id,
            name: task.name || listed.name,
            companyName: customer.name || "Empresa não identificada",
            companyCode: customer.code,
            companyCnpj: customer.cnpj || documentByCustomer.get(customerId),
            competence: competenceOf(task) || competenceOf(listed),
          },
          documentType: doc.name,
          uploadedAt: file.upload_date,
          syncedAt: new Date().toISOString(),
        });

        if (!saved) {
          summary.ignored.push({ fileName, reason: "conteúdo não é OFX, PDF nem OFC" });
        } else {
          summary.saved++;
          if (saved.format === "ofx") summary.savedOfx++;
          else if (saved.format === "ofc") summary.savedOfc++;
          else summary.savedPdf++;
          if (!saved.driveFileId) await copyToDrive(saved, downloaded.buffer, false);
          if (saved.format === "pdf" && isCheckingPdf(doc, fileName)) {
            checkingPdfs.push({ id: saved.id, buffer: downloaded.buffer });
          }
          if (saved.format === "ofc") ofcFiles.push({ id: saved.id, buffer: downloaded.buffer });
        }
      } catch (err: any) {
        summary.errors.push({ taskId: task._id, fileName, message: err?.message || String(err) });
      }
    }

    // Cliente enviou somente PDF do extrato de conta corrente: gera o OFX a partir do PDF
    if (!clientSentOfx && checkingPdfs.length) {
      await convertCheckingPdfs(checkingPdfs, summary, copyToDrive);
    }
    if (ofcFiles.length) await convertCheckingPdfs(ofcFiles, summary, copyToDrive);
  }).finally(async () => {
    // Painel: grava os itens coletados (também se a etapa 2 for interrompida)
    summary.snapshot.documentRequests = await safeSnapshotWrite(() =>
      saveDocumentRequests(documentRequestRows),
    );
  });

  summary.finishedAt = new Date().toISOString();
  return summary;
}
