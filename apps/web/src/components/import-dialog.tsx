"use client";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { OpportunityInput } from "@mega/contracts";
import {
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  UploadCloud,
} from "lucide-react";
import { api } from "@/lib/api";
import { localDate, money } from "@/lib/format";
import { Dialog } from "./dialog";

type Preview = { token: string; name: string; rows: OpportunityInput[] };
export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  async function readFile(file?: File) {
    if (!file) return;
    setError("");
    setPreview(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError(
        "Selecione um arquivo CSV. Outros formatos serão definidos na próxima etapa.",
      );
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("O arquivo deve ter até 2 MB e 500 registros.");
      return;
    }
    setBusy(true);
    try {
      const rawText = await file.text();
      const result = Papa.parse<Record<string, string>>(rawText, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) =>
          h
            .trim()
            .toLowerCase()
            .replace(/^\uFEFF/, ""),
      });
      if (result.errors.length)
        throw new Error(
          "O CSV está malformado. Confira os separadores e as colunas do modelo.",
        );
      const required = ["empresa", "contato", "valor", "vencimento"];
      if (required.some((h) => !result.meta.fields?.includes(h)))
        throw new Error(
          "Colunas obrigatórias: empresa, contato, valor e vencimento. Baixe o modelo para conferir.",
        );
      const rows = result.data.map((r, i) => {
        if (!/^\d+(\.\d{1,2})?$/.test(r.valor?.trim()))
          throw new Error(
            `Linha ${i + 2}: use um valor como 18500.00, sem R$ ou separador de milhar.`,
          );
        return {
          company: r.empresa,
          contact: r.contato,
          value: Number(r.valor),
          dueDate: r.vencimento,
          email: r.email?.trim() || "",
          owner: r.responsavel?.trim() || "Ana Martins",
          priority: r.prioridade?.trim() || "medium",
          notes: r.observacoes || "",
          stage: "new",
          source: "Relatório CSV",
        };
      });
      setPreview(
        await api<Preview>("/imports/preview", {
          method: "POST",
          body: JSON.stringify({
            name: file.name,
            rows,
            rawContent: rawText,
            fileSize: file.size,
            mimeType: file.type || "text/csv",
          }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  function downloadTemplate() {
    const content = Papa.unparse([
      {
        empresa: "Empresa Exemplo",
        contato: "Maria Silva",
        email: "maria@example.com",
        valor: "18500.00",
        vencimento: localDate(),
        responsavel: "Ana Martins",
        prioridade: "medium",
        observacoes: "Agendar primeira conversa",
      },
    ]);
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-relatorio-mega.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await api(`/imports/${preview.token}/commit`, { method: "POST" });
      setPreview(null);
      await onImported();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na importação.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Importar relatório"
      subtitle="Revise seus registros antes de trazê-los para o CRM."
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="import-content">
        <div className="import-steps">
          <span className={!preview ? "current" : "complete"}>
            <b>{preview ? <Check size={13} /> : "1"}</b>Selecionar arquivo
          </span>
          <i />
          <span className={preview ? "current" : ""}>
            <b>2</b>Revisar e importar
          </span>
        </div>
        {!preview ? (
          <>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
            <button
              className={`upload-zone ${dragging ? "dragging" : ""}`}
              disabled={busy}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy) void readFile(e.dataTransfer.files[0]);
              }}
            >
              <span className="upload-icon">
                <UploadCloud size={28} />
              </span>
              <strong>
                {busy ? "Validando relatório…" : "Solte seu relatório aqui"}
              </strong>
              <span>ou clique para selecionar no computador</span>
              <small>CSV · até 2 MB · máximo de 500 registros</small>
            </button>
            <div className="template-note">
              <FileSpreadsheet size={22} />
              <div>
                <strong>Comece com o modelo</strong>
                <p>Empresa, contato, valor e data do próximo contato.</p>
              </div>
              <button className="secondary-button" onClick={downloadTemplate}>
                <Download size={15} />
                Baixar CSV
              </button>
            </div>
            <p className="import-help">
              Os registros entram em <b>Novos leads</b>. Valores usam ponto
              decimal (18500.00) e datas usam AAAA-MM-DD. Este formato inicial
              pode ser adaptado aos seus relatórios.
            </p>
          </>
        ) : (
          <>
            <div className="preview-summary">
              <span className="upload-icon">
                <FileSpreadsheet size={24} />
              </span>
              <div>
                <strong>{preview.name}</strong>
                <p>{preview.rows.length} registros prontos para importar</p>
              </div>
              <span className="valid-tag">
                <Check size={13} />
                Validado
              </span>
            </div>
            <div className="preview-table">
              <table>
                <thead>
                  <tr>
                    <th>Empresa / contato</th>
                    <th>Valor</th>
                    <th>Etapa</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <strong>{r.company}</strong>
                        <small>{r.contact}</small>
                      </td>
                      <td>{money(r.value)}</td>
                      <td>
                        <span className="tag">Novos leads</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="import-help">
              Confira os dados. Importar o mesmo arquivo novamente criará novos
              registros.
            </p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        <span className="footer-caption">
          Seus dados ficam em memória nesta versão.
        </span>
        <div className="spacer" />
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => (preview ? setPreview(null) : onClose())}
        >
          {preview ? "Trocar arquivo" : "Cancelar"}
        </button>
        {preview && (
          <button className="primary-button" disabled={busy} onClick={commit}>
            {busy ? "Importando…" : `Importar ${preview.rows.length} registros`}
            <ArrowRight size={16} />
          </button>
        )}
      </footer>
    </Dialog>
  );
}
