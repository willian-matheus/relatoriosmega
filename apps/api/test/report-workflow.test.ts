import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applyReportAction,
  readReportWorkflow,
  recordChange,
  reportSummary,
  ReportUpdateError,
  type Opportunity,
  type Report,
  type ReportAction,
} from "@mega/contracts";
import { CrmService } from "../src/crm.service";
import {
  commitImport,
  getWorkspaceSnapshot,
  previewImport,
  saveOpportunity,
  updateReport,
} from "../../web/src/lib/crm-backend";

const author = { name: "Equipe de teste", email: "equipe@example.test" };
const input = {
  company: "Empresa de teste",
  contact: "Contato de teste",
  value: 200,
  dueDate: "2026-09-20",
};

for (const backend of ["NestJS", "Next.js"] as const) {
  test(`${backend}: importação, documentos, conversa contextual, resolução e concorrência`, async () => {
    delete process.env.SUPABASE_URL;
    const service = new CrmService();
    const preview =
      backend === "NestJS" ? service.preview.bind(service) : previewImport;
    const commit =
      backend === "NestJS" ? service.commit.bind(service) : commitImport;
    const snapshot =
      backend === "NestJS"
        ? service.snapshot.bind(service)
        : getWorkspaceSnapshot;
    const update =
      backend === "NestJS" ? service.updateReport.bind(service) : updateReport;
    const save =
      backend === "NestJS" ? service.save.bind(service) : saveOpportunity;
    let report = structuredClone(
      await commit(preview({ name: "teste.csv", rows: [input] }).token),
    );
    const record = (await snapshot()).opportunities.find(
      (o) => o.reportId === report.id,
    )!;
    assert.ok(record, "a importação deve vincular o registro ao relatório");
    await save({ ...input, value: 300 }, record.id);
    assert.equal(
      (await snapshot()).opportunities.find((o) => o.id === record.id)
        ?.reportId,
      report.id,
    );
    async function act(action: ReportAction) {
      report = structuredClone(
        await update(
          report.id,
          { version: report.updatedAt ?? report.createdAt, action },
          author,
        ),
      );
    }
    const initialVersion = report.updatedAt ?? report.createdAt;
    await act({
      type: "document.add",
      name: "Contrato",
      context: "Assinatura na página 2",
    });
    await assert.rejects(
      update(
        report.id,
        {
          version: initialVersion,
          action: { type: "document.add", name: "Versão antiga" },
        },
        author,
      ),
      (e: unknown) => e instanceof ReportUpdateError && e.status === 409,
    );
    await act({
      type: "question.add",
      text: "Qual é o prazo?",
      context: "Cláusula 4",
      opportunityId: record.id,
    });
    const question = report.workflow!.questions[0];
    assert.equal(question.recordLabel, "Empresa de teste · Contato de teste");
    await act({
      type: "question.reply",
      id: question.id,
      text: "O prazo é de 30 dias.",
    });
    assert.equal(
      report.workflow!.questions[0].status,
      "open",
      "responder não deve resolver automaticamente",
    );
    await act({
      type: "review",
      through: new Date(report.updatedAt!).toISOString(),
    });
    let summary = reportSummary(report, (await snapshot()).opportunities);
    assert.equal(summary.pendingDocuments, 1);
    assert.equal(summary.unresolved, 1, "revisar não apaga as pendências");
    assert.equal(summary.newRecords, 0);
    assert.equal(summary.changes.length, 0);
    await act({ type: "question.status", id: question.id, status: "resolved" });
    await act({
      type: "document.status",
      id: report.workflow!.documents[0].id,
      status: "received",
    });
    summary = reportSummary(report, (await snapshot()).opportunities);
    assert.equal(summary.pendingDocuments + summary.unresolved, 0);
    assert.equal(
      report.workflow!.questions[0].replies[0].author.email,
      author.email,
    );
    await act({ type: "question.status", id: question.id, status: "open" });
    const loaded = (await snapshot()).reports.find((r) => r.id === report.id)!;
    assert.deepEqual(
      loaded.workflow,
      report.workflow,
      "conversa deve sobreviver a uma nova consulta",
    );
    const other = await commit(
      preview({ name: "outro.csv", rows: [input] }).token,
    );
    await assert.rejects(
      update(
        other.id,
        {
          version: other.updatedAt ?? other.createdAt,
          action: {
            type: "question.add",
            text: "Não pertence",
            opportunityId: record.id,
          },
        },
        author,
      ),
      (e: unknown) => e instanceof ReportUpdateError && e.status === 400,
    );
    await assert.rejects(
      update(
        report.id,
        {
          version: report.updatedAt,
          action: {
            type: "question.reply",
            id: randomUUID(),
            text: "Resposta",
          },
        },
        author,
      ),
    );
    await assert.rejects(
      update(
        report.id,
        {
          version: report.updatedAt,
          action: { type: "document.add", name: "   " },
        },
        author,
      ),
    );
    await assert.rejects(
      update(
        randomUUID(),
        {
          version: report.updatedAt,
          action: { type: "document.add", name: "Contrato" },
        },
        author,
      ),
      (e: unknown) => e instanceof ReportUpdateError && e.status === 404,
    );
  });
}

test("destaques usam a revisão e a atualização real dos registros", () => {
  const createdAt = "2026-09-01T10:00:00Z";
  const updatedAt = "2026-09-02T10:00:00Z";
  const record = {
    ...input,
    id: randomUUID(),
    reportId: "report",
    createdAt,
    updatedAt,
  } as Opportunity;
  assert.equal(recordChange(record, null), "new");
  assert.equal(recordChange(record, "2026-09-01T11:00:00Z"), "changed");
  assert.equal(recordChange(record, updatedAt), null);
  const report: Report = {
    id: "report",
    name: "Real.csv",
    count: 1,
    createdAt,
  };
  assert.equal(reportSummary(report, [record]).lastUpdated, updatedAt);
  assert.equal(
    reportSummary(report, [{ ...record, reportId: "outro" }]).records.length,
    0,
  );
});

test("contexto permanece após remover o registro e conteúdo inválido não é apagado", () => {
  const now = "2026-09-18T10:00:00Z";
  const record = { ...input, id: randomUUID() } as Opportunity;
  const workflow = applyReportAction(
    readReportWorkflow({ importedBy: "web" }),
    {
      type: "question.add",
      text: "Confirmar valor",
      context: "Linha 2",
      opportunityId: record.id,
    },
    author,
    [record],
    now,
    randomUUID,
  );
  const replied = applyReportAction(
    workflow,
    {
      type: "question.reply",
      id: workflow.questions[0].id,
      text: "Valor confirmado",
    },
    author,
    [],
    now,
    randomUUID,
  );
  assert.equal(
    replied.questions[0].recordLabel,
    "Empresa de teste · Contato de teste",
  );
  assert.equal(replied.questions[0].context, "Linha 2");
  assert.equal(
    workflow.questions[0].replies.length,
    0,
    "não deve mutar dados antes da persistência",
  );
  assert.throws(() =>
    readReportWorkflow({ workflow: { questions: "inválido" } }),
  );
  assert.throws(() =>
    applyReportAction(
      workflow,
      { type: "review", through: "2027-01-01T00:00:00Z" },
      author,
      [],
      now,
      randomUUID,
    ),
  );
});
