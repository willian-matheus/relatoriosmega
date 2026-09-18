"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  History,
  Building2,
  Calendar,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderOpen,
  FolderSync,
  LoaderCircle,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  ShieldCheck,
  Building,
  Sparkles,
} from "lucide-react";
import { HistoryCompanyItem } from "@/lib/gestta-sync";
import { GesttaCronStatus } from "@/lib/gestta-cron";

export function HistoryView() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<HistoryCompanyItem[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [competencesList, setCompetencesList] = useState<string[]>([]);

  // Filtros
  const [search, setSearch] = useState("");
  const [competenceFilter, setCompetenceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Status do Cron 10 min
  const [cronStatus, setCronStatus] = useState<GesttaCronStatus | null>(null);
  const [nextRunCountdown, setNextRunCountdown] = useState<string>("");

  // Accordion de empresas abertas
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(
    new Set(),
  );

  // Carrega histórico do banco
  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (competenceFilter && competenceFilter !== "all") {
        params.set("competence", competenceFilter);
      }
      if (statusFilter && statusFilter !== "all") {
        params.set("status", statusFilter);
      }

      const res = await fetch(`/api/gestta/history?${params.toString()}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Falha ao carregar histórico");
      }

      setCompanies(json.companies || []);
      setTotalTasks(json.totalTasks || 0);
      setTotalCompanies(json.totalCompanies || 0);
      if (json.competencesList?.length) {
        setCompetencesList(json.competencesList);
      }
    } catch (err: any) {
      console.error("Erro ao buscar histórico:", err);
      setError(err.message || "Erro de conexão.");
    } finally {
      setLoading(false);
    }
  }, [search, competenceFilter, statusFilter]);

  // Carrega status do Cron de 10 minutos
  const fetchCronStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cron/gestta-sync");
      const json = await res.json();
      if (json.success && json.status) {
        setCronStatus(json.status);
      }
    } catch (e) {
      console.warn("Erro ao consultar status do cron:", e);
    }
  }, []);

  // Dispara sincronização manual imediata
  const handleTriggerSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      const res = await fetch("/api/cron/gestta-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_now" }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(
          json.data?.result?.error || json.error || "Falha ao sincronizar",
        );
      }
      await fetchHistory();
      await fetchCronStatus();
    } catch (err: any) {
      setError(err.message || "Erro ao executar sincronização");
    } finally {
      setSyncing(false);
    }
  };

  // Toggle empresa individual
  const toggleCompany = (companyName: string) => {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(companyName)) {
        next.delete(companyName);
      } else {
        next.add(companyName);
      }
      return next;
    });
  };

  // Expandir / Recolher todos
  const toggleAll = () => {
    if (expandedCompanies.size === companies.length) {
      setExpandedCompanies(new Set());
    } else {
      setExpandedCompanies(new Set(companies.map((c) => c.companyName)));
    }
  };

  // Efeito inicial
  useEffect(() => {
    fetchHistory();
    fetchCronStatus();
  }, [fetchHistory, fetchCronStatus]);

  // Polling leve para atualizar cronStatus e contagem regressiva
  useEffect(() => {
    const timer = setInterval(() => {
      fetchCronStatus();
    }, 15000);
    return () => clearInterval(timer);
  }, [fetchCronStatus]);

  // Atualiza contagem regressiva para a próxima execução
  useEffect(() => {
    if (!cronStatus?.nextRun) {
      setNextRunCountdown("");
      return;
    }

    const updateCountdown = () => {
      const diff = new Date(cronStatus.nextRun!).getTime() - Date.now();
      if (diff <= 0) {
        setNextRunCountdown("Executando agora...");
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setNextRunCountdown(`${mins}m ${secs.toString().padStart(2, "0")}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [cronStatus?.nextRun]);

  // Estatísticas calculadas
  const stats = useMemo(() => {
    let overdueCount = 0;
    let completedCount = 0;
    let openCount = 0;

    for (const comp of companies) {
      for (const compGroup of comp.competences) {
        for (const t of compGroup.tasks) {
          if (t.overdue) overdueCount++;
          if (t.status.toLowerCase().includes("conclu") || t.status.toLowerCase().includes("baixad")) {
            completedCount++;
          } else {
            openCount++;
          }
        }
      }
    }
    return { overdueCount, completedCount, openCount };
  }, [companies]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* BANNER DO AGENDAMENTO AUTOMÁTICO DE 10 MINUTOS */}
      <section
        style={{
          background:
            "linear-gradient(135deg, rgba(20, 22, 32, 0.95), rgba(16, 17, 25, 0.98))",
          border: "1px solid rgba(171, 137, 250, 0.25)",
          borderRadius: "16px",
          padding: "20px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "4px",
            height: "100%",
            background: "linear-gradient(to bottom, #ab89fa, #72ceb1)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "12px",
              background: "rgba(171, 137, 250, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(171, 137, 250, 0.3)",
              color: "var(--purple)",
            }}
          >
            <Clock size={22} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: "17px",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: "#fff",
                }}
              >
                Rotina Automática Gestta
              </h2>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "rgba(114, 206, 177, 0.12)",
                  color: "#72ceb1",
                  border: "1px solid rgba(114, 206, 177, 0.3)",
                  borderRadius: "20px",
                  padding: "3px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: "#72ceb1",
                    boxShadow: "0 0 8px #72ceb1",
                  }}
                />
                Verificação a cada 10 min: Ativa
              </span>
            </div>
            <p
              style={{
                margin: "4px 0 0 0",
                fontSize: "13px",
                color: "var(--muted)",
                lineHeight: "1.4",
              }}
            >
              A cada 10 minutos o CRM se conecta ao Gestta, extrai relatórios novos, salva no banco e sincroniza pastas no Google Drive.
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
          }}
        >
          {cronStatus?.lastRun && (
            <div
              style={{
                textAlign: "right",
                fontSize: "12px",
                color: "var(--muted)",
                background: "rgba(255,255,255,0.03)",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
              }}
            >
              <div>
                Último ciclo:{" "}
                <strong style={{ color: "#fff" }}>
                  {new Date(cronStatus.lastRun).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
              </div>
              {nextRunCountdown && (
                <div style={{ color: "var(--purple)", marginTop: "2px" }}>
                  Próximo em: <strong>{nextRunCountdown}</strong>
                </div>
              )}
            </div>
          )}

          <a
            href="https://drive.google.com/drive/folders/1wvt_O9uu1vMKJhmjhDBvZkqD7svqz3tM"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "9px 16px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--line)",
              borderRadius: "10px",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 500,
              transition: "all 0.2s",
            }}
          >
            <FolderOpen size={16} color="var(--purple)" />
            Pasta Raiz no Drive
            <ExternalLink size={13} style={{ opacity: 0.6 }} />
          </a>

          <button
            type="button"
            className="primary-button"
            onClick={handleTriggerSync}
            disabled={syncing || cronStatus?.isRunning}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              fontSize: "13px",
              fontWeight: 600,
              background: "linear-gradient(135deg, #10b981, #059669)",
              border: "none",
              boxShadow: "0 4px 14px rgba(16, 185, 129, 0.25)",
            }}
          >
            {syncing || cronStatus?.isRunning ? (
              <>
                <LoaderCircle size={16} className="spin" />
                Sincronizando Gestta...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Verificar Gestta Agora
              </>
            )}
          </button>
        </div>
      </section>

      {/* MÉTRICAS EM CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}
      >
        <div
          className="surface"
          style={{
            padding: "18px 20px",
            borderRadius: "12px",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
              Empresas Catalogadas
            </span>
            <Building2 size={18} color="var(--purple)" />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#fff" }}>
            {totalCompanies}
          </div>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            Com pastas e relatórios estruturados
          </span>
        </div>

        <div
          className="surface"
          style={{
            padding: "18px 20px",
            borderRadius: "12px",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
              Relatórios e Tarefas
            </span>
            <FileText size={18} color="#72ceb1" />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#72ceb1" }}>
            {totalTasks}
          </div>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            Gravados no banco e no Google Drive
          </span>
        </div>

        <div
          className="surface"
          style={{
            padding: "18px 20px",
            borderRadius: "12px",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
              Concluídas / Baixadas
            </span>
            <CheckCircle2 size={18} color="#60a5fa" />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#60a5fa" }}>
            {stats.completedCount}
          </div>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            Obrigações finalizadas no Gestta
          </span>
        </div>

        <div
          className="surface"
          style={{
            padding: "18px 20px",
            borderRadius: "12px",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
              Em Atraso
            </span>
            <AlertTriangle size={18} color="#f87171" />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#f87171" }}>
            {stats.overdueCount}
          </div>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            Demandam atenção imediata
          </span>
        </div>
      </div>

      {/* BARRA DE FILTROS E BUSCA */}
      <section
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "14px",
          flexWrap: "wrap",
          padding: "14px 18px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: "1 1 320px" }}>
          <div className="search-field" style={{ width: "100%", maxWidth: "450px" }}>
            <Search size={16} />
            <input
              type="text"
              placeholder="Buscar por Empresa, CNPJ, Código ou Tarefa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Filtro Competência */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Calendar size={14} color="var(--muted)" />
            <select
              value={competenceFilter}
              onChange={(e) => setCompetenceFilter(e.target.value)}
              style={{
                background: "var(--card)",
                color: "#fff",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "13px",
              }}
            >
              <option value="all">Todas as Competências</option>
              {competencesList.map((comp) => (
                <option key={comp} value={comp}>
                  Competência {comp}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Filter size={14} color="var(--muted)" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                background: "var(--card)",
                color: "#fff",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "13px",
              }}
            >
              <option value="all">Todos os Status</option>
              <option value="Concluída">Concluída</option>
              <option value="Em Andamento">Em Andamento</option>
              <option value="overdue">Em Atraso (Vencidas)</option>
            </select>
          </div>

          {/* Botão Expandir / Recolher Tudo */}
          {companies.length > 0 && (
            <button
              type="button"
              className="secondary-button"
              onClick={toggleAll}
              style={{
                padding: "8px 14px",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <ChevronDown size={14} />
              {expandedCompanies.size === companies.length
                ? "Recolher Todos"
                : "Expandir Todos"}
            </button>
          )}
        </div>
      </section>

      {/* MENSAGEM DE ERRO SE HOUVER */}
      {error && (
        <div
          style={{
            padding: "14px 18px",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "10px",
            color: "#fca5a5",
            fontSize: "13px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            className="text-button"
            onClick={fetchHistory}
            style={{ color: "#fff", textDecoration: "underline" }}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ESTADO DE CARREGAMENTO */}
      {loading ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "60px 20px",
            gap: "12px",
            color: "var(--muted)",
          }}
        >
          <LoaderCircle size={28} className="spin" color="var(--purple)" />
          <div style={{ fontSize: "15px", color: "#fff", fontWeight: 600 }}>
            Consultando histórico de relatórios no banco...
          </div>
          <div style={{ fontSize: "13px" }}>
            Buscando dados agrupados por Empresa e Competência
          </div>
        </div>
      ) : companies.length === 0 ? (
        /* ESTADO VAZIO */
        <div
          className="surface"
          style={{
            padding: "60px 20px",
            textAlign: "center",
            borderRadius: "16px",
            border: "1px dashed var(--line)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "14px",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "rgba(171, 137, 250, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--purple)",
            }}
          >
            <FolderSync size={28} />
          </div>
          <h3 style={{ margin: 0, fontSize: "18px", color: "#fff", fontWeight: 600 }}>
            Nenhum relatório encontrado no histórico
          </h3>
          <p style={{ margin: 0, maxWidth: "450px", color: "var(--muted)", fontSize: "14px" }}>
            O histórico ainda não possui registros para os filtros selecionados ou a sincronização inicial ainda não foi executada.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={handleTriggerSync}
            disabled={syncing}
            style={{
              marginTop: "8px",
              padding: "10px 20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {syncing ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Executar Sincronização Agora
          </button>
        </div>
      ) : (
        /* LISTA DE EMPRESAS COM SUB-MENU EM ACCORDION */
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {companies.map((company) => {
            const isExpanded = expandedCompanies.has(company.companyName);

            return (
              <div
                key={company.companyName}
                style={{
                  background: "var(--panel)",
                  border: isExpanded
                    ? "1px solid rgba(171, 137, 250, 0.4)"
                    : "1px solid var(--line)",
                  borderRadius: "12px",
                  overflow: "hidden",
                  transition: "all 0.2s ease",
                  boxShadow: isExpanded
                    ? "0 4px 20px rgba(0,0,0,0.3)"
                    : "none",
                }}
              >
                {/* CABEÇALHO DA EMPRESA (CLICÁVEL PARA EXPANDIR O SUB-MENU) */}
                <div
                  onClick={() => toggleCompany(company.companyName)}
                  style={{
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    userSelect: "none",
                    background: isExpanded
                      ? "rgba(171, 137, 250, 0.05)"
                      : "transparent",
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isExpanded) {
                      e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isExpanded) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: "rgba(171, 137, 250, 0.1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--purple)",
                        flexShrink: 0,
                      }}
                    >
                      <Building2 size={18} />
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          flexWrap: "wrap",
                        }}
                      >
                        <strong
                          style={{
                            fontSize: "15px",
                            color: "#fff",
                            letterSpacing: "-0.01em",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {company.companyName}
                        </strong>

                        {company.companyCode && (
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              background: "rgba(255,255,255,0.06)",
                              color: "var(--muted)",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              border: "1px solid var(--line)",
                            }}
                          >
                            Cód: {company.companyCode}
                          </span>
                        )}

                        {company.companyCnpj && (
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              background: "rgba(255,255,255,0.06)",
                              color: "var(--muted)",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              border: "1px solid var(--line)",
                            }}
                          >
                            CNPJ: {company.companyCnpj}
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          marginTop: "4px",
                          fontSize: "12px",
                          color: "var(--muted)",
                        }}
                      >
                        <span>
                          {company.competences.length}{" "}
                          {company.competences.length === 1
                            ? "competência"
                            : "competências"}
                        </span>
                        <span>•</span>
                        <span>
                          {company.totalTasks}{" "}
                          {company.totalTasks === 1
                            ? "relatório/tarefa"
                            : "relatórios/tarefas"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      flexShrink: 0,
                    }}
                  >
                    {company.driveFolderId && (
                      <a
                        href={`https://drive.google.com/drive/folders/${company.driveFolderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Abrir pasta desta empresa no Google Drive"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "8px",
                          background: "rgba(171, 137, 250, 0.08)",
                          color: "var(--purple)",
                          border: "1px solid rgba(171, 137, 250, 0.2)",
                          fontSize: "12px",
                          fontWeight: 500,
                        }}
                      >
                        <FolderOpen size={14} />
                        Drive
                        <ExternalLink size={11} />
                      </a>
                    )}

                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(255,255,255,0.04)",
                        color: isExpanded ? "var(--purple)" : "var(--muted)",
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown size={18} />
                      ) : (
                        <ChevronRight size={18} />
                      )}
                    </div>
                  </div>
                </div>

                {/* SUB-MENU EXPANSÍVEL (RELATÓRIOS E TAREFAS RESGATADOS DO GESTTA) */}
                {isExpanded && (
                  <div
                    style={{
                      padding: "0 20px 20px 20px",
                      borderTop: "1px solid var(--line)",
                      background: "rgba(0, 0, 0, 0.2)",
                    }}
                  >
                    <div
                      style={{
                        padding: "12px 0 16px 0",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          color: "var(--muted)",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Sub-Menu: Relatórios e Tarefas Resgatados do Gestta
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                      }}
                    >
                      {company.competences.map((group) => (
                        <div
                          key={group.competence}
                          style={{
                            background: "var(--card)",
                            border: "1px solid var(--line)",
                            borderRadius: "10px",
                            padding: "16px",
                          }}
                        >
                          {/* Cabeçalho da Competência */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: "12px",
                              paddingBottom: "10px",
                              borderBottom: "1px solid var(--line)",
                              flexWrap: "wrap",
                              gap: "8px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <Calendar size={15} color="var(--purple)" />
                              <strong style={{ fontSize: "14px", color: "#fff" }}>
                                Competência: {group.competence}
                              </strong>
                              <span
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 7px",
                                  borderRadius: "10px",
                                  background: "rgba(255,255,255,0.06)",
                                  color: "var(--muted)",
                                }}
                              >
                                {group.tasks.length} itens
                              </span>
                            </div>
                          </div>

                          {/* Linhas de Relatórios / Tarefas */}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px",
                            }}
                          >
                            {group.tasks.map((task) => {
                              const isOverdue = task.overdue;
                              const isCompleted =
                                task.status.toLowerCase().includes("conclu") ||
                                task.status.toLowerCase().includes("baixad");

                              return (
                                <div
                                  key={task.id}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "10px 14px",
                                    borderRadius: "8px",
                                    background: "rgba(255, 255, 255, 0.02)",
                                    border: isOverdue
                                      ? "1px solid rgba(248, 113, 113, 0.25)"
                                      : "1px solid rgba(255, 255, 255, 0.04)",
                                    flexWrap: "wrap",
                                    gap: "10px",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "12px",
                                      flex: "1 1 260px",
                                      minWidth: 0,
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: "30px",
                                        height: "30px",
                                        borderRadius: "6px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        background: isOverdue
                                          ? "rgba(248, 113, 113, 0.12)"
                                          : isCompleted
                                            ? "rgba(114, 206, 177, 0.12)"
                                            : "rgba(96, 165, 250, 0.12)",
                                        color: isOverdue
                                          ? "#f87171"
                                          : isCompleted
                                            ? "#72ceb1"
                                            : "#60a5fa",
                                        flexShrink: 0,
                                      }}
                                    >
                                      <FileText size={15} />
                                    </div>

                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div
                                        style={{
                                          fontSize: "13px",
                                          fontWeight: 600,
                                          color: "#fff",
                                          whiteSpace: "nowrap",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                        }}
                                      >
                                        {task.name}
                                      </div>

                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "10px",
                                          fontSize: "11px",
                                          color: "var(--muted)",
                                          marginTop: "2px",
                                          flexWrap: "wrap",
                                        }}
                                      >
                                        {task.dueDate && (
                                          <span>
                                            Vencimento:{" "}
                                            <strong style={{ color: "#eee" }}>
                                              {task.dueDate}
                                            </strong>
                                          </span>
                                        )}
                                        {task.legalDate && (
                                          <span>
                                            Prazo Legal:{" "}
                                            <strong style={{ color: "#eee" }}>
                                              {task.legalDate}
                                            </strong>
                                          </span>
                                        )}
                                        {task.department && (
                                          <span>Depto: {task.department}</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Status e Botões do Google Drive */}
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "10px",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: "11px",
                                        fontWeight: 600,
                                        padding: "3px 8px",
                                        borderRadius: "6px",
                                        background: isOverdue
                                          ? "rgba(248, 113, 113, 0.15)"
                                          : isCompleted
                                            ? "rgba(114, 206, 177, 0.15)"
                                            : "rgba(96, 165, 250, 0.15)",
                                        color: isOverdue
                                          ? "#fca5a5"
                                          : isCompleted
                                            ? "#72ceb1"
                                            : "#93c5fd",
                                        border: isOverdue
                                          ? "1px solid rgba(248, 113, 113, 0.3)"
                                          : isCompleted
                                            ? "1px solid rgba(114, 206, 177, 0.3)"
                                            : "1px solid rgba(96, 165, 250, 0.3)",
                                      }}
                                    >
                                      {task.status}
                                      {isOverdue ? " (Atrasada)" : ""}
                                    </span>

                                    {task.fileLink ? (
                                      <a
                                        href={task.fileLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title="Abrir Relatório da Tarefa no Google Drive (.txt)"
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "5px",
                                          padding: "5px 10px",
                                          borderRadius: "6px",
                                          background: "rgba(171, 137, 250, 0.1)",
                                          border: "1px solid rgba(171, 137, 250, 0.25)",
                                          color: "var(--purple)",
                                          fontSize: "12px",
                                          fontWeight: 500,
                                        }}
                                      >
                                        <FileText size={13} />
                                        Relatório .txt
                                        <ExternalLink size={10} />
                                      </a>
                                    ) : (
                                      <span
                                        style={{
                                          fontSize: "11px",
                                          color: "var(--muted)",
                                        }}
                                      >
                                        Sincronizado no CRM
                                      </span>
                                    )}

                                    {task.jsonLink && (
                                      <a
                                        href={task.jsonLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title="Abrir Dados Técnicos em JSON no Google Drive"
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "4px",
                                          padding: "5px 9px",
                                          borderRadius: "6px",
                                          background: "rgba(255, 255, 255, 0.04)",
                                          border: "1px solid var(--line)",
                                          color: "var(--muted)",
                                          fontSize: "11px",
                                        }}
                                      >
                                        <FileCode size={12} />
                                        .json
                                        <ExternalLink size={10} />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
