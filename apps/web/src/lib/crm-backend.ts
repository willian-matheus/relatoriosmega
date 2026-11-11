import { randomUUID } from "node:crypto";
import {
  applyReportAction,
  readReportWorkflow,
  reportUpdateSchema,
  ReportUpdateError,
  ReportAuthor,
  ReportRecordRef,
  Json,
  Activity,
  Report,
} from "@mega/contracts";
import { getOptionalSupabaseServerClient } from "./supabase-server";
import {
  ReportTask,
  reportTaskColumns,
  reportTaskLabel,
  toReportTask,
  WorkspaceSnapshot,
} from "./report-tasks";

// Memória temporária caso Supabase não esteja configurado (listas vazias).
const memoryReports: Report[] = [];
const memoryActivities: Activity[] = [];

/** Limite de segurança ao paginar as tarefas vinculadas aos relatórios. */
const TASK_PAGE_SIZE = 1000;
const TASK_MAX_ROWS = 20000;

function toReport(row: any): Report {
  return {
    id: row.id,
    name: row.name,
    count: row.count,
    workflow: readReportWorkflow(row.metadata),
    filePath: row.file_path,
    fileSize: row.file_size ? Number(row.file_size) : null,
    mimeType: row.mime_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toActivity(row: any): Activity {
  return {
    id: row.id,
    company: row.company,
    description: row.description,
    createdAt: row.created_at,
  };
}

function toRecordRef(task: ReportTask): ReportRecordRef {
  return { id: task.id, company: task.company, label: reportTaskLabel(task) };
}

/** Tarefas do Gestta ligadas a algum relatório (paginado: o PostgREST limita a 1000 linhas). */
async function loadReportTasks(
  supabase: NonNullable<ReturnType<typeof getOptionalSupabaseServerClient>>,
): Promise<ReportTask[]> {
  const tasks: ReportTask[] = [];
  for (let from = 0; from < TASK_MAX_ROWS; from += TASK_PAGE_SIZE) {
    const { data, error } = await (supabase as any)
      .from("gestta_history_records")
      .select(reportTaskColumns)
      .not("report_id", "is", null)
      .order("company_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + TASK_PAGE_SIZE - 1);
    if (error) throw new Error("Não foi possível carregar as tarefas dos relatórios.");
    const rows = (data ?? []) as any[];
    tasks.push(...rows.map(toReportTask));
    if (rows.length < TASK_PAGE_SIZE) break;
  }
  return tasks;
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    return { reports: memoryReports, activities: memoryActivities, tasks: [] };
  }

  const [repRes, actRes, tasks] = await Promise.all([
    supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("activities")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40),
    loadReportTasks(supabase),
  ]);

  if (repRes.error || actRes.error)
    throw new Error("Não foi possível carregar os dados do workspace.");

  return {
    reports: (repRes.data || []).map(toReport),
    activities: (actRes.data || []).map(toActivity),
    tasks,
  };
}

export async function getReportDownloadUrl(
  id: string,
): Promise<{ url: string; name: string }> {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data: report, error } = await supabase
    .from("reports")
    .select("name, file_path")
    .eq("id", id)
    .single();
  if (error || !report || !report.file_path) {
    throw new Error("Arquivo do relatório não encontrado.");
  }
  const { data, error: signErr } = await supabase.storage
    .from("reports")
    .createSignedUrl(report.file_path, 3600);
  if (signErr || !data?.signedUrl) {
    throw new Error("Erro ao gerar link de download.");
  }
  return { url: data.signedUrl, name: report.name };
}

export async function updateReport(
  id: string,
  body: unknown,
  author: ReportAuthor,
): Promise<Report> {
  const parsed = reportUpdateSchema.safeParse(body);
  if (!parsed.success)
    throw new ReportUpdateError(
      parsed.error.issues.map((i) => i.message).join("; "),
      400,
    );
  const { version, action } = parsed.data;
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const report = memoryReports.find((r) => r.id === id);
    if (!report) throw new ReportUpdateError("Relatório não encontrado.", 404);
    if ((report.updatedAt ?? report.createdAt) !== version)
      throw new ReportUpdateError(
        "O relatório foi atualizado por outra pessoa. Atualize a lista e tente novamente.",
        409,
      );
    const now = new Date(
      Math.max(Date.now(), Date.parse(version) + 1),
    ).toISOString();
    try {
      report.workflow = applyReportAction(
        report.workflow ?? readReportWorkflow(null),
        action,
        author,
        [],
        now,
        randomUUID,
      );
    } catch (error) {
      throw new ReportUpdateError(
        error instanceof Error ? error.message : "Ação inválida.",
        400,
      );
    }
    report.updatedAt = now;
    return report;
  }
  const { data: row, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error)
    throw new ReportUpdateError("Não foi possível carregar o relatório.", 503);
  if (!row) throw new ReportUpdateError("Relatório não encontrado.", 404);
  if (row.updated_at !== version)
    throw new ReportUpdateError(
      "O relatório foi atualizado por outra pessoa. Atualize a lista e tente novamente.",
      409,
    );
  // Só uma dúvida ligada a uma tarefa precisa consultar as tarefas do relatório.
  let records: ReportRecordRef[] = [];
  if (action.type === "question.add" && action.opportunityId) {
    const task = await (supabase as any)
      .from("gestta_history_records")
      .select(reportTaskColumns)
      .eq("report_id", id)
      .eq("id", action.opportunityId)
      .maybeSingle();
    if (task.error)
      throw new ReportUpdateError("Não foi possível carregar as tarefas.", 503);
    if (task.data) records = [toRecordRef(toReportTask(task.data))];
  }
  let workflow;
  try {
    workflow = applyReportAction(
      readReportWorkflow(row.metadata),
      action,
      author,
      records,
      new Date().toISOString(),
      randomUUID,
    );
  } catch (error) {
    throw new ReportUpdateError(
      error instanceof Error ? error.message : "Ação inválida.",
      400,
    );
  }
  const metadata =
    row.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? row.metadata
      : {};
  // Compare-and-swap prevents one collaborator from overwriting another's reply.
  const saved = await supabase
    .from("reports")
    .update({ metadata: { ...metadata, workflow } as Json })
    .eq("id", id)
    .eq("updated_at", version)
    .select("*")
    .maybeSingle();
  if (saved.error)
    throw new ReportUpdateError(
      "Não foi possível salvar o acompanhamento.",
      503,
    );
  if (!saved.data)
    throw new ReportUpdateError(
      "O relatório mudou enquanto você escrevia. Atualize a lista e tente novamente.",
      409,
    );
  return toReport(saved.data);
}
