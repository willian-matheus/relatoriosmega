import { z } from "zod";
import type { Opportunity, Report } from "./index";

const authorSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().max(254),
});
const messageSchema = z.object({
  id: z.string(),
  text: z.string(),
  author: authorSchema,
  createdAt: z.string(),
});
export const reportWorkflowSchema = z.object({
  reviewedAt: z.string().nullable().default(null),
  documents: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        context: z.string(),
        status: z.enum(["pending", "received"]),
        author: authorSchema,
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    )
    .default([]),
  questions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        context: z.string(),
        opportunityId: z.string().nullable(),
        recordLabel: z.string().nullable(),
        status: z.enum(["open", "resolved"]),
        author: authorSchema,
        createdAt: z.string(),
        updatedAt: z.string(),
        replies: z.array(messageSchema),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        author: authorSchema,
        createdAt: z.string(),
      }),
    )
    .default([]),
});
export type ReportWorkflow = z.infer<typeof reportWorkflowSchema>;
export type ReportAuthor = z.infer<typeof authorSchema>;
const text = z.string().trim().min(1, "Preencha o texto.").max(4000);
const context = z.string().trim().max(500).default("");
export const reportActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("document.add"),
    name: z.string().trim().min(1).max(180),
    context,
  }),
  z.object({
    type: z.literal("document.status"),
    id: z.string().uuid(),
    status: z.enum(["pending", "received"]),
  }),
  z.object({
    type: z.literal("question.add"),
    text,
    context,
    opportunityId: z.string().uuid().nullable().default(null),
  }),
  z.object({ type: z.literal("question.reply"), id: z.string().uuid(), text }),
  z.object({
    type: z.literal("question.status"),
    id: z.string().uuid(),
    status: z.enum(["open", "resolved"]),
  }),
  z.object({ type: z.literal("review"), through: z.iso.datetime() }),
]);
export const reportUpdateSchema = z.object({
  version: z.string().min(1),
  action: reportActionSchema,
});
export type ReportAction = z.infer<typeof reportActionSchema>;
export class ReportUpdateError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function readReportWorkflow(metadata: unknown): ReportWorkflow {
  const raw =
    metadata && typeof metadata === "object" && "workflow" in metadata
      ? metadata.workflow
      : undefined;
  // Missing metadata is normal for reports imported before this feature.
  // Invalid stored content must fail visibly rather than be overwritten as empty.
  return reportWorkflowSchema.parse(raw ?? {});
}

export function applyReportAction(
  current: ReportWorkflow,
  action: ReportAction,
  author: ReportAuthor,
  records: Opportunity[],
  now: string,
  newId: () => string,
): ReportWorkflow {
  const next = structuredClone(current);
  let description = "";
  switch (action.type) {
    case "document.add":
      next.documents.push({
        id: newId(),
        name: action.name,
        context: action.context,
        status: "pending",
        author,
        createdAt: now,
        updatedAt: now,
      });
      description = `Documento solicitado: ${action.name}`;
      break;
    case "document.status": {
      const doc = next.documents.find((d) => d.id === action.id);
      if (!doc) throw new Error("Documento não encontrado neste relatório.");
      doc.status = action.status;
      doc.updatedAt = now;
      description = `${action.status === "received" ? "Documento recebido" : "Documento voltou a ficar pendente"}: ${doc.name}`;
      break;
    }
    case "question.add": {
      const record = action.opportunityId
        ? records.find((r) => r.id === action.opportunityId)
        : null;
      if (action.opportunityId && !record)
        throw new Error("O registro não pertence a este relatório.");
      next.questions.push({
        id: newId(),
        text: action.text,
        context: action.context,
        opportunityId: record?.id ?? null,
        recordLabel: record ? `${record.company} · ${record.contact}` : null,
        status: "open",
        author,
        createdAt: now,
        updatedAt: now,
        replies: [],
      });
      description = `Nova dúvida: ${action.text.slice(0, 160)}`;
      break;
    }
    case "question.reply": {
      const question = next.questions.find((q) => q.id === action.id);
      if (!question) throw new Error("Dúvida não encontrada neste relatório.");
      question.replies.push({
        id: newId(),
        text: action.text,
        author,
        createdAt: now,
      });
      question.updatedAt = now;
      description = `Resposta adicionada: ${question.text.slice(0, 160)}`;
      break;
    }
    case "question.status": {
      const question = next.questions.find((q) => q.id === action.id);
      if (!question) throw new Error("Dúvida não encontrada neste relatório.");
      question.status = action.status;
      question.updatedAt = now;
      description = `${action.status === "resolved" ? "Dúvida resolvida" : "Dúvida reaberta"}: ${question.text.slice(0, 160)}`;
      break;
    }
    case "review":
      if (Date.parse(action.through) > Date.parse(now))
        throw new Error("A revisão não pode ter uma data futura.");
      if (
        !next.reviewedAt ||
        Date.parse(action.through) > Date.parse(next.reviewedAt)
      )
        next.reviewedAt = action.through;
      return next;
  }
  next.events.unshift({ id: newId(), description, author, createdAt: now });
  return next;
}

export function recordChange(record: Opportunity, reviewedAt: string | null) {
  if (!reviewedAt || Date.parse(record.createdAt) > Date.parse(reviewedAt))
    return "new";
  if (Date.parse(record.updatedAt) > Date.parse(reviewedAt)) return "changed";
  return null;
}

export function reportSummary(report: Report, opportunities: Opportunity[]) {
  const workflow = report.workflow ?? readReportWorkflow(null);
  const records = opportunities.filter((o) => o.reportId === report.id);
  const lastUpdated = [
    report.updatedAt ?? report.createdAt,
    ...records.map((o) => o.updatedAt),
  ].reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
  return {
    records,
    workflow,
    lastUpdated,
    pendingDocuments: workflow.documents.filter((d) => d.status === "pending")
      .length,
    unresolved: workflow.questions.filter((q) => q.status === "open").length,
    newRecords: records.filter(
      (r) => recordChange(r, workflow.reviewedAt) === "new",
    ).length,
    changedRecords: records.filter(
      (r) => recordChange(r, workflow.reviewedAt) === "changed",
    ).length,
    changes: workflow.events.filter(
      (e) =>
        !workflow.reviewedAt ||
        Date.parse(e.createdAt) > Date.parse(workflow.reviewedAt),
    ),
  };
}
