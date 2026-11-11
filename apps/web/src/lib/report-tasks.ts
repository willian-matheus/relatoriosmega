import type { Activity, Report } from "@mega/contracts";

/**
 * Tarefa do Gestta vinculada a um relatório (linha de `gestta_history_records`).
 * Sem dependências de servidor: pode ser importado por componentes cliente.
 */
export type ReportTask = {
  id: string;
  gesttaTaskId: string;
  reportId: string | null;
  company: string;
  companyCode: string | null;
  companyCnpj: string | null;
  taskName: string;
  competence: string | null;
  status: string | null;
  dueDate: string | null;
  legalDate: string | null;
  department: string | null;
  overdue: boolean;
  pdfLink: string | null;
  fileLink: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Dados carregados pela tela principal (`GET /api/workspace`). */
export type WorkspaceSnapshot = {
  reports: Report[];
  activities: Activity[];
  tasks: ReportTask[];
};

export type ReportTaskState = "done" | "overdue" | "open";

export function reportTaskState(task: Pick<ReportTask, "status" | "overdue">): ReportTaskState {
  if (task.status === "DONE") return "done";
  if (task.overdue) return "overdue";
  return "open";
}

export const reportTaskStateLabel: Record<ReportTaskState, string> = {
  done: "Concluída",
  overdue: "Atrasada",
  open: "Em aberto",
};

/** Rótulo gravado nas dúvidas que apontam para uma tarefa. */
export function reportTaskLabel(task: Pick<ReportTask, "company" | "taskName" | "competence">) {
  return [task.company, task.taskName, task.competence].filter(Boolean).join(" · ");
}

export function toReportTask(row: any): ReportTask {
  const day = (value: unknown) =>
    typeof value === "string" && value ? value.slice(0, 10) : null;
  return {
    id: row.id,
    gesttaTaskId: row.gestta_task_id,
    reportId: row.report_id ?? null,
    company: row.company_name,
    companyCode: row.company_code ?? null,
    companyCnpj: row.company_cnpj ?? null,
    taskName: row.task_name,
    competence: row.competence ?? null,
    status: row.status ?? null,
    dueDate: day(row.due_date),
    legalDate: day(row.legal_date),
    department: row.department ?? null,
    overdue: Boolean(row.overdue),
    pdfLink: row.drive_pdf_link ?? null,
    fileLink: row.drive_file_link ?? null,
    syncedAt: row.synced_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

/** Colunas lidas de `gestta_history_records` (evita trazer `raw_data`). */
export const reportTaskColumns =
  "id, gestta_task_id, report_id, company_name, company_code, company_cnpj, task_name, competence, status, due_date, legal_date, department, overdue, drive_pdf_link, drive_file_link, synced_at, created_at, updated_at";
