"use client";
import { useRef, useState } from "react";
import {
  Opportunity,
  Report,
  ReportAction,
  recordChange,
  reportSummary,
} from "@mega/contracts";
import {
  ArrowLeft,
  ArrowDownToLine,
  Check,
  FileText,
  MessageCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import "./report-center.css";

const date = (value: string) => new Date(value).toLocaleString("pt-BR");
const statusLabel: Record<string, string> = {
  completed: "Disponível",
  pending: "Pendente",
  processing: "Processando",
  failed: "Falha na importação",
};

export function ReportCenter({
  reports,
  opportunities,
  onImport,
  onDownload,
  onRefresh,
  onUpdated,
  onOpenRecord,
}: {
  reports: Report[];
  opportunities: Opportunity[];
  onImport: () => void;
  onDownload: (id: string) => void;
  onRefresh: () => Promise<void>;
  onUpdated: (report: Report) => void;
  onOpenRecord: (record: Opportunity) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const summaries = reports.map((report) => ({
    report,
    ...reportSummary(report, opportunities),
  }));
  const pending = summaries.reduce((n, s) => n + s.pendingDocuments, 0);
  const unresolved = summaries.reduce((n, s) => n + s.unresolved, 0);
  const latest = summaries
    .map((s) => s.lastUpdated)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const selectedReport = reports.find((r) => r.id === selected);
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await onRefresh();
    } catch {
      setError("Não foi possível atualizar os relatórios. Tente novamente.");
    } finally {
      setRefreshing(false);
    }
  }
  if (selectedReport)
    return (
      <ReportDetails
        key={selectedReport.id}
        report={selectedReport}
        opportunities={opportunities}
        onBack={() => setSelected(null)}
        onUpdated={onUpdated}
        onDownload={onDownload}
        onRefresh={refresh}
        refreshing={refreshing}
        refreshError={error}
        onOpenRecord={onOpenRecord}
      />
    );
  const visible = summaries.filter(
    (s) =>
      s.report.name
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")) &&
      (filter === "all" ||
        (filter === "pending" &&
          (s.pendingDocuments > 0 ||
            s.unresolved > 0 ||
            s.report.status === "pending" ||
            s.report.status === "failed")) ||
        (filter === "changes" &&
          (s.newRecords > 0 || s.changedRecords > 0 || s.changes.length > 0))),
  );
  return (
    <div className="report-center">
      <div className="report-center-heading">
        <div>
          <span className="eyebrow">ACOMPANHAMENTO</span>
          <h2>Relatórios e pendências</h2>
          <p>
            As informações, os próximos passos e as conversas no mesmo lugar.
          </p>
        </div>
        <div className="report-actions">
          <button
            className="secondary-button"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? "spinner" : ""} />{" "}
            Atualizar
          </button>
          <button className="primary-button" onClick={onImport}>
            <Plus size={16} /> Importar relatório
          </button>
        </div>
      </div>
      <div className="report-summary" aria-label="Resumo dos relatórios">
        <div>
          <span>Relatórios disponíveis</span>
          <strong>
            {
              reports.filter((r) => !r.status || r.status === "completed")
                .length
            }
          </strong>
        </div>
        <div>
          <span>Documentos pendentes</span>
          <strong>{pending}</strong>
        </div>
        <div>
          <span>Dúvidas sem solução</span>
          <strong>{unresolved}</strong>
        </div>
        <div>
          <span>Última atualização</span>
          <strong className="report-date">
            {latest ? date(latest) : "Ainda sem registros"}
          </strong>
        </div>
      </div>
      {error && (
        <p role="alert" className="report-error">
          {error}
        </p>
      )}
      <div className="report-filter">
        <label htmlFor="report-search">Buscar</label>
        <input
          id="report-search"
          type="search"
          placeholder="Nome do relatório"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label htmlFor="report-filter">Exibir</label>
        <select
          id="report-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Todos os relatórios</option>
          <option value="pending">Com pendências</option>
          <option value="changes">Com novidades</option>
        </select>
        <span>{visible.length} relatório(s)</span>
      </div>
      {visible.length === 0 ? (
        <div className="surface report-empty">
          <FileText size={32} />
          <h3>
            {reports.length
              ? "Nenhum relatório neste filtro"
              : "Nenhum relatório disponível"}
          </h3>
          <p>
            {reports.length
              ? "Ajuste a busca ou o filtro para encontrar seu relatório."
              : "Importe seu primeiro CSV para acompanhar documentos, registros e dúvidas."}
          </p>
        </div>
      ) : (
        <div className="report-list">
          {visible.map((s) => (
            <button
              key={s.report.id}
              className="surface report-card"
              onClick={() => {
                setError("");
                setSelected(s.report.id);
              }}
            >
              <div className="report-card-title">
                <FileText size={22} />
                <h3>{s.report.name}</h3>
                <span className="report-badge">
                  {statusLabel[s.report.status ?? "completed"] ??
                    s.report.status}
                </span>
              </div>
              <p>
                {s.records.length} registros · Atualizado em{" "}
                {date(s.lastUpdated)}
              </p>
              <div className="report-badges">
                {s.newRecords > 0 && (
                  <span className="report-badge new">
                    {s.newRecords} novos registros
                  </span>
                )}
                {s.changedRecords > 0 && (
                  <span className="report-badge changed">
                    {s.changedRecords} registros alterados
                  </span>
                )}
                {s.changes.length > 0 && (
                  <span className="report-badge changed">
                    {s.changes.length} atualizações
                  </span>
                )}
                <span
                  className={`report-badge ${s.pendingDocuments ? "pending" : ""}`}
                >
                  {s.pendingDocuments} documentos pendentes
                </span>
                <span
                  className={`report-badge ${s.unresolved ? "pending" : ""}`}
                >
                  {s.unresolved} dúvidas sem solução
                </span>
              </div>
              <span className="report-open">Abrir acompanhamento →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportDetails({
  report,
  opportunities,
  onBack,
  onUpdated,
  onDownload,
  onRefresh,
  refreshing,
  refreshError,
  onOpenRecord,
}: {
  report: Report;
  opportunities: Opportunity[];
  onBack: () => void;
  onUpdated: (report: Report) => void;
  onDownload: (id: string) => void;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  refreshError: string;
  onOpenRecord: (record: Opportunity) => void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [docName, setDocName] = useState("");
  const [docContext, setDocContext] = useState("");
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [recordId, setRecordId] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [onlyOpen, setOnlyOpen] = useState(false);
  const summary = reportSummary(report, opportunities);
  const { workflow, records } = summary;
  async function act(action: ReportAction): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await api<Report>(`/reports/${report.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: report.updatedAt ?? report.createdAt,
          action,
        }),
      });
      onUpdated(updated);
      setNotice("Acompanhamento salvo.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="report-center report-detail" aria-busy={busy}>
      <button className="secondary-button report-back" onClick={onBack}>
        <ArrowLeft size={16} /> Todos os relatórios
      </button>
      <div className="report-center-heading">
        <div>
          <span className="eyebrow">RELATÓRIO</span>
          <h2>{report.name}</h2>
          <p>Última atualização: {date(summary.lastUpdated)}</p>
        </div>
        <div className="report-actions">
          <button
            className="secondary-button"
            onClick={onRefresh}
            disabled={busy || refreshing}
          >
            <RefreshCw size={16} /> Atualizar
          </button>
          {report.filePath && (
            <button
              className="secondary-button"
              onClick={() => onDownload(report.id)}
            >
              <ArrowDownToLine size={16} /> Arquivo original
            </button>
          )}
        </div>
      </div>
      {(error || refreshError) && (
        <p className="report-error" role="alert">
          {error || refreshError}
        </p>
      )}
      {notice && (
        <p className="report-notice" role="status">
          {notice}
        </p>
      )}
      <div className="surface report-review">
        <div>
          <h3>Desde a última revisão da equipe</h3>
          <p>
            {workflow.reviewedAt
              ? `Revisado até ${date(workflow.reviewedAt)}.`
              : "Este relatório ainda não foi revisado."}{" "}
            Os itens sem solução continuam destacados.
          </p>
          <div className="report-badges">
            <span className="report-badge new">{summary.newRecords} novos</span>
            <span className="report-badge changed">
              {summary.changedRecords} alterados
            </span>
            <span className="report-badge pending">
              {summary.pendingDocuments + summary.unresolved} pendências
            </span>
          </div>
        </div>
        <button
          className="secondary-button"
          disabled={busy || refreshing}
          onClick={() =>
            act({
              type: "review",
              through: new Date(summary.lastUpdated).toISOString(),
            })
          }
        >
          <Check size={16} /> Marcar como revisado
        </button>
      </div>
      <div className="report-detail-grid">
        <section className="surface report-panel">
          <div className="report-panel-heading">
            <h3>Documentos</h3>
            <span className="report-badge pending">
              {summary.pendingDocuments} pendentes
            </span>
          </div>
          <p className="report-hint">
            Registre o que falta e marque como recebido após conferir o
            documento.
          </p>
          {workflow.documents.length === 0 && (
            <p className="report-empty-inline">Nenhum documento solicitado.</p>
          )}
          <ul className="report-document-list">
            {workflow.documents.map((doc) => (
              <li key={doc.id}>
                <div>
                  <strong>{doc.name}</strong>
                  {doc.context && <p>{doc.context}</p>}
                  <small>
                    Solicitado por {doc.author.name} · {date(doc.createdAt)}
                  </small>
                </div>
                <div>
                  <span
                    className={`report-badge ${doc.status === "pending" ? "pending" : "new"}`}
                  >
                    {doc.status === "pending" ? "Pendente" : "Recebido"}
                  </span>
                  <button
                    className="report-text-button"
                    disabled={busy}
                    onClick={() =>
                      act({
                        type: "document.status",
                        id: doc.id,
                        status:
                          doc.status === "pending" ? "received" : "pending",
                      })
                    }
                  >
                    {doc.status === "pending"
                      ? "Marcar recebido"
                      : "Reabrir pendência"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="report-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act({
                  type: "document.add",
                  name: docName,
                  context: docContext,
                })
              ) {
                setDocName("");
                setDocContext("");
              }
            }}
          >
            <label htmlFor="document-name">Documento pendente</label>
            <input
              id="document-name"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              required
              maxLength={180}
              placeholder="Nome do documento"
              disabled={busy}
            />
            <label htmlFor="document-context">
              O que precisa ser conferido? (opcional)
            </label>
            <input
              id="document-context"
              value={docContext}
              onChange={(e) => setDocContext(e.target.value)}
              maxLength={500}
              disabled={busy}
            />
            <button
              className="secondary-button"
              disabled={busy || !docName.trim()}
            >
              <Plus size={15} /> Registrar pendência
            </button>
          </form>
        </section>
        <section className="surface report-panel">
          <div className="report-panel-heading">
            <h3>Atualizações</h3>
            <span className="report-badge">
              {summary.changes.length} desde a revisão
            </span>
          </div>
          {summary.changes.length === 0 && (
            <p className="report-empty-inline">
              Nenhuma nova atualização no acompanhamento.
            </p>
          )}
          <ol className="report-event-list">
            {summary.changes.map((event) => (
              <li key={event.id}>
                <p>{event.description}</p>
                <small>
                  {event.author.name} · {date(event.createdAt)}
                </small>
              </li>
            ))}
          </ol>
          {workflow.events.length > summary.changes.length && (
            <details>
              <summary>
                Ver histórico anterior (
                {workflow.events.length - summary.changes.length})
              </summary>
              <ol className="report-event-list">
                {workflow.events
                  .filter((e) => !summary.changes.some((c) => c.id === e.id))
                  .map((event) => (
                    <li key={event.id}>
                      <p>{event.description}</p>
                      <small>
                        {event.author.name} · {date(event.createdAt)}
                      </small>
                    </li>
                  ))}
              </ol>
            </details>
          )}
        </section>
      </div>
      <section className="surface report-panel">
        <div className="report-panel-heading">
          <h3>Registros do relatório</h3>
          <span className="report-badge">{records.length}</span>
        </div>
        {records.length === 0 ? (
          <p className="report-empty-inline">
            Nenhum registro vinculado a este relatório.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empresa / contato</th>
                  <th>Valor</th>
                  <th>Atualização</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const change = recordChange(record, workflow.reviewedAt);
                  return (
                    <tr key={record.id}>
                      <td>
                        <strong>{record.company}</strong>
                        <br />
                        <small>{record.contact}</small>
                      </td>
                      <td>{money(record.value)}</td>
                      <td>
                        <span
                          className={`report-badge ${change === "new" ? "new" : change === "changed" ? "changed" : ""}`}
                        >
                          {change === "new"
                            ? "Novo registro"
                            : change === "changed"
                              ? "Alterado"
                              : "Revisado"}
                        </span>
                        <br />
                        <small>{date(record.updatedAt)}</small>
                      </td>
                      <td>
                        <button
                          className="report-text-button"
                          onClick={() => onOpenRecord(record)}
                        >
                          Abrir registro
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="surface report-panel">
        <div className="report-panel-heading">
          <h3>
            <MessageCircle size={19} /> Dúvidas e respostas
          </h3>
          <label className="report-checkbox">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(e) => setOnlyOpen(e.target.checked)}
            />{" "}
            Somente sem solução ({summary.unresolved})
          </label>
        </div>
        <p className="report-hint">
          Respostas ficam na conversa original. Marque como resolvida quando a
          dúvida estiver esclarecida.
        </p>
        {workflow.questions.filter((q) => !onlyOpen || q.status === "open")
          .length === 0 && (
          <p className="report-empty-inline">
            {onlyOpen
              ? "Nenhuma dúvida sem solução."
              : "Ainda não há dúvidas neste relatório."}
          </p>
        )}
        <div className="report-questions">
          {workflow.questions
            .filter((q) => !onlyOpen || q.status === "open")
            .map((q) => (
              <article key={q.id} className={`report-question ${q.status}`}>
                <div className="report-panel-heading">
                  <span
                    className={`report-badge ${q.status === "open" ? "pending" : "new"}`}
                  >
                    {q.status === "open" ? "Sem solução" : "Resolvida"}
                  </span>
                  <small>
                    {q.author.name} · {date(q.createdAt)}
                  </small>
                </div>
                {(q.context || q.recordLabel) && (
                  <div className="report-context">
                    <strong>Contexto</strong>
                    {q.recordLabel && (
                      <p>
                        {q.recordLabel}
                        {q.opportunityId &&
                        !records.some((r) => r.id === q.opportunityId)
                          ? " (registro removido)"
                          : ""}
                      </p>
                    )}
                    {q.context && <p>{q.context}</p>}
                  </div>
                )}
                <p className="report-message">{q.text}</p>
                <div className="report-replies">
                  {q.replies.map((reply) => (
                    <div key={reply.id}>
                      <small>
                        {reply.author.name} · {date(reply.createdAt)}
                      </small>
                      <p className="report-message">{reply.text}</p>
                    </div>
                  ))}
                </div>
                <form
                  className="report-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await act({
                        type: "question.reply",
                        id: q.id,
                        text: replies[q.id] ?? "",
                      })
                    )
                      setReplies((prev) => ({ ...prev, [q.id]: "" }));
                  }}
                >
                  <label htmlFor={`reply-${q.id}`}>Responder à dúvida</label>
                  <textarea
                    id={`reply-${q.id}`}
                    value={replies[q.id] ?? ""}
                    onChange={(e) =>
                      setReplies((prev) => ({
                        ...prev,
                        [q.id]: e.target.value,
                      }))
                    }
                    required
                    maxLength={4000}
                    rows={2}
                    disabled={busy}
                  />
                  <div className="report-actions">
                    <button
                      className="secondary-button"
                      disabled={busy || !replies[q.id]?.trim()}
                    >
                      Salvar resposta
                    </button>
                    <button
                      type="button"
                      className="report-text-button"
                      disabled={busy}
                      onClick={() =>
                        act({
                          type: "question.status",
                          id: q.id,
                          status: q.status === "open" ? "resolved" : "open",
                        })
                      }
                    >
                      {q.status === "open"
                        ? "Marcar como resolvida"
                        : "Reabrir dúvida"}
                    </button>
                  </div>
                </form>
              </article>
            ))}
        </div>
        <form
          className="report-form report-new-question"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act({
                type: "question.add",
                text: question,
                context,
                opportunityId: recordId || null,
              })
            ) {
              setQuestion("");
              setContext("");
              setRecordId("");
            }
          }}
        >
          <h4>Registrar uma dúvida</h4>
          <div className="report-form-grid">
            <div>
              <label htmlFor="question-record">Registro relacionado</label>
              <select
                id="question-record"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
                disabled={busy}
              >
                <option value="">Relatório completo</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.company} · {r.contact}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="question-context">
                Página, seção ou referência (opcional)
              </label>
              <input
                id="question-context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                maxLength={500}
                disabled={busy}
              />
            </div>
          </div>
          <label htmlFor="question-text">Sua dúvida</label>
          <textarea
            id="question-text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            maxLength={4000}
            rows={3}
            disabled={busy}
          />
          <button
            className="primary-button"
            disabled={busy || !question.trim()}
          >
            <Plus size={16} /> Registrar dúvida
          </button>
        </form>
      </section>
    </div>
  );
}
