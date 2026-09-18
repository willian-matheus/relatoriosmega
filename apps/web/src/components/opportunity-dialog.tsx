"use client";
import { useState } from "react";
import {
  Opportunity,
  OpportunityInput,
  opportunitySchema,
  owners,
  Stage,
  stages,
} from "@mega/contracts";
import { ArrowRight, Trash2 } from "lucide-react";
import { Dialog } from "./dialog";
import { localDate } from "@/lib/format";

export function OpportunityDialog({
  opportunity,
  stage,
  onClose,
  onSave,
  onDelete,
}: {
  opportunity?: Opportunity;
  stage: Stage;
  onClose: () => void;
  onSave: (input: OpportunityInput, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState<OpportunityInput>(
    opportunity || {
      company: "",
      contact: "",
      email: "",
      value: 0,
      stage,
      owner: "Ana Martins",
      priority: "medium",
      source: "Cadastro manual",
      dueDate: localDate(),
      notes: "",
    },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function field<K extends keyof OpportunityInput>(
    key: K,
    value: OpportunityInput[K],
  ) {
    setForm((old) => ({ ...old, [key]: value }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = opportunitySchema.safeParse(form);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(result.data, opportunity?.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!opportunity) return;
    setBusy(true);
    try {
      await onDelete(opportunity.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={opportunity ? "Detalhes da oportunidade" : "Nova oportunidade"}
      subtitle={
        opportunity
          ? `Acompanhe sua conversa com ${opportunity.company}.`
          : "Um novo relacionamento começa por aqui."
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save} className="opportunity-form">
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Empresa
              <input
                required
                autoFocus
                maxLength={100}
                placeholder="Nome da empresa"
                value={form.company}
                onChange={(e) => field("company", e.target.value)}
              />
            </label>
            <label>
              Contato
              <input
                required
                maxLength={100}
                placeholder="Nome do contato"
                value={form.contact}
                onChange={(e) => field("contact", e.target.value)}
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                placeholder="contato@empresa.com"
                value={form.email}
                onChange={(e) => field("email", e.target.value)}
              />
            </label>
            <label>
              Valor da oportunidade (R$)
              <input
                required
                type="number"
                min="0"
                max="999999999"
                step="0.01"
                value={form.value}
                onChange={(e) => field("value", e.target.valueAsNumber)}
              />
            </label>
            <label>
              Etapa
              <select
                value={form.stage}
                onChange={(e) => field("stage", e.target.value as Stage)}
              >
                {stages.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Responsável
              <select
                value={form.owner}
                onChange={(e) =>
                  field("owner", e.target.value as OpportunityInput["owner"])
                }
              >
                {owners.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              Prioridade
              <select
                value={form.priority}
                onChange={(e) =>
                  field(
                    "priority",
                    e.target.value as OpportunityInput["priority"],
                  )
                }
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
              </select>
            </label>
            <label>
              Próximo contato
              <input
                required
                type="date"
                value={form.dueDate}
                onChange={(e) => field("dueDate", e.target.value)}
              />
            </label>
          </div>
          <label>
            Origem
            <input
              required
              maxLength={80}
              value={form.source}
              onChange={(e) => field("source", e.target.value)}
            />
          </label>
          <label>
            Observações
            <textarea
              rows={3}
              maxLength={2000}
              placeholder="O que precisamos saber sobre esta oportunidade?"
              value={form.notes}
              onChange={(e) => field("notes", e.target.value)}
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {confirmDelete && (
          <div className="delete-confirm">
            <p>Excluir esta oportunidade do pipeline?</p>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={remove}
            >
              Confirmar exclusão
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setConfirmDelete(false)}
            >
              Voltar
            </button>
          </div>
        )}
        <footer className="dialog-footer">
          {opportunity && (
            <button
              type="button"
              className="icon-button danger"
              disabled={busy}
              aria-label="Excluir oportunidade"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={18} />
            </button>
          )}
          <div className="spacer" />
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy
              ? "Salvando…"
              : opportunity
                ? "Salvar alterações"
                : "Criar oportunidade"}
            <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
