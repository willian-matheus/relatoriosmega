"use client";

import React, { useState } from "react";
import {
  FolderSync,
  Building2,
  FolderOpen,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  Check,
  FileSpreadsheet,
  FileText,
  ChevronRight,
} from "lucide-react";
import { Dialog } from "./dialog";

interface GesttaSyncDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function GesttaSyncDialog({
  open,
  onClose,
  onSuccess,
}: GesttaSyncDialogProps) {
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(20);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleStartSync() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/integrations/gestta/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit,
          startDate: "2026-08-01T00:00:00.000Z",
          endDate: "2026-10-31T23:59:59.999Z",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${res.status} ao sincronizar`);
      }

      const data = await res.json();
      setResult(data);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao executar sincronização",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      title="Sincronizar Gestta com Google Drive e Mega CRM"
      subtitle="Obtém tarefas e relatórios do Gestta, salva no CRM e organiza no Google Drive por Empresa / Competência / Tarefa."
      onClose={() => {
        if (!loading) {
          setError(null);
          onClose();
        }
      }}
      wide={true}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {!result && (
          <>
            <div
              style={{
                background: "rgba(171, 137, 250, 0.08)",
                border: "1px solid rgba(171, 137, 250, 0.25)",
                borderRadius: "12px",
                padding: "16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  color: "var(--purple)",
                  fontWeight: 600,
                  fontSize: "15px",
                }}
              >
                <FolderSync size={20} />
                Como funciona a automação:
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "20px",
                  fontSize: "13px",
                  color: "var(--muted)",
                  lineHeight: "1.6",
                }}
              >
                <li>
                  Acessa a API do <strong>Gestta</strong> com as credenciais
                  autenticadas da MEGA CONTABILIDADE.
                </li>
                <li>
                  Busca as tarefas e obrigações do período com prazos, status e
                  detalhes.
                </li>
                <li>
                  Registra as tarefas como oportunidades e relatórios no{" "}
                  <strong>Mega CRM</strong>.
                </li>
                <li>
                  Cria e organiza a hierarquia de pastas no{" "}
                  <strong>Google Drive</strong>:
                  <div
                    style={{
                      fontFamily: "monospace",
                      marginTop: "6px",
                      background: "rgba(0,0,0,0.3)",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      color: "#a7f3d0",
                    }}
                  >
                    📁 Mega Contabilidade - Gestta
                    <br />
                    &nbsp;&nbsp;└── 📁 [Nome da Empresa]
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── 📁 Competência
                    [AAAA-MM]
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└──
                    📁 [Nome da Tarefa]
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├──
                    📄 Relatorio_Tarefa_Gestta.txt
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└──
                    📄 detalhes_tarefa.json
                  </div>
                </li>
              </ul>
            </div>

            <div
              style={{
                display: "flex",
                gap: "14px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <label
                style={{
                  fontSize: "13px",
                  color: "var(--text)",
                  fontWeight: 500,
                }}
              >
                Quantidade de Tarefas para Sincronizar:
              </label>
              <select
                className="input-select"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                disabled={loading}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  background: "var(--surface)",
                  color: "#fff",
                  border: "1px solid var(--line)",
                  cursor: "pointer",
                }}
              >
                <option value={5}>5 Tarefas (Teste Rápido)</option>
                <option value={15}>15 Tarefas</option>
                <option value={30}>30 Tarefas</option>
                <option value={50}>50 Tarefas</option>
                <option value={100}>100 Tarefas</option>
              </select>
            </div>
          </>
        )}

        {error && (
          <div
            style={{
              padding: "14px 18px",
              background: "rgba(248, 113, 113, 0.1)",
              border: "1px solid rgba(248, 113, 113, 0.3)",
              borderRadius: "10px",
              color: "#f87171",
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                background: "rgba(52, 211, 153, 0.1)",
                border: "1px solid rgba(52, 211, 153, 0.3)",
                borderRadius: "12px",
                display: "flex",
                alignItems: "flex-start",
                gap: "14px",
              }}
            >
              <CheckCircle2
                size={24}
                color="#34d399"
                style={{ flexShrink: 0, marginTop: "2px" }}
              />
              <div style={{ flex: 1 }}>
                <h4
                  style={{
                    margin: "0 0 6px 0",
                    color: "#34d399",
                    fontSize: "16px",
                    fontWeight: 600,
                  }}
                >
                  Sincronização Concluída com Sucesso!
                </h4>
                <p
                  style={{
                    margin: "0 0 12px 0",
                    color: "var(--text)",
                    fontSize: "14px",
                  }}
                >
                  Foram sincronizadas <strong>{result.totalTasks} tarefas</strong>{" "}
                  de <strong>{result.totalCompanies} empresas</strong>, salvas no
                  CRM e organizadas no Google Drive.
                </p>
                {result.driveRootUrl && (
                  <a
                    href={result.driveRootUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 16px",
                      borderRadius: "8px",
                      background: "#34d399",
                      color: "#0f172a",
                      fontWeight: 600,
                      fontSize: "13px",
                      textDecoration: "none",
                    }}
                  >
                    <FolderOpen size={16} />
                    Abrir Pasta no Google Drive
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>

            <div
              style={{
                maxHeight: "260px",
                overflowY: "auto",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                padding: "12px 16px",
                background: "rgba(0,0,0,0.2)",
              }}
            >
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  display: "block",
                  marginBottom: "10px",
                }}
              >
                Estrutura de Pastas Criadas no Google Drive:
              </span>
              {result.companies?.map((comp: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: "14px",
                    paddingBottom: "10px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#fff",
                    }}
                  >
                    <Building2 size={16} color="var(--purple)" />
                    {comp.companyName}
                    {comp.companyCode && (
                      <span
                        style={{
                          fontSize: "11px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(255,255,255,0.08)",
                          color: "var(--muted)",
                        }}
                      >
                        Cód. {comp.companyCode}
                      </span>
                    )}
                  </div>

                  <div style={{ marginLeft: "20px", marginTop: "6px" }}>
                    {comp.competences?.map((c: any, cIdx: number) => (
                      <div key={cIdx} style={{ marginTop: "4px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "13px",
                            color: "#93c5fd",
                          }}
                        >
                          <Calendar size={13} />
                          Competência: {c.competence}
                          {c.csvFileLink && (
                            <a
                              href={c.csvFileLink}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: "#34d399",
                                fontSize: "11px",
                                marginLeft: "8px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "3px",
                              }}
                            >
                              <FileSpreadsheet size={12} /> CSV Consolidado
                            </a>
                          )}
                        </div>

                        <div style={{ marginLeft: "18px", marginTop: "4px" }}>
                          {c.tasks?.map((t: any, tIdx: number) => (
                            <div
                              key={tIdx}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                fontSize: "12px",
                                color: "var(--muted)",
                                marginTop: "2px",
                              }}
                            >
                              <ChevronRight size={12} />
                              <span style={{ color: "var(--text)" }}>
                                {t.name}
                              </span>
                              <span
                                style={{
                                  fontSize: "10px",
                                  padding: "1px 5px",
                                  borderRadius: "4px",
                                  background:
                                    t.status === "DONE"
                                      ? "rgba(52, 211, 153, 0.15)"
                                      : "rgba(234, 179, 8, 0.15)",
                                  color:
                                    t.status === "DONE" ? "#34d399" : "#eab308",
                                }}
                              >
                                {t.status}
                              </span>
                              {t.fileLink && (
                                <a
                                  href={t.fileLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Ver relatório no Drive"
                                  style={{
                                    color: "var(--purple)",
                                    marginLeft: "auto",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "3px",
                                  }}
                                >
                                  <FileText size={12} />
                                  Drive
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            marginTop: "10px",
          }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={loading}
          >
            {result ? "Fechar" : "Cancelar"}
          </button>
          {!result && (
            <button
              type="button"
              className="primary-button"
              onClick={handleStartSync}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="spinner" />
                  Sincronizando Gestta & Drive...
                </>
              ) : (
                <>
                  <FolderSync size={16} />
                  Iniciar Sincronização
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
