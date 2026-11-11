"use client";
import { useCallback, useEffect, useState } from "react";
import { Activity } from "@mega/contracts";
import {
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  CircleX,
  FileBarChart2,
  FileSpreadsheet,
  FolderOpen,
  FolderSync,
  LoaderCircle,
  Menu,
  SlidersHorizontal,
  X,
  ExternalLink,
  LogOut,
  RefreshCw,
  History,
  LayoutDashboard,
} from "lucide-react";
import { api } from "@/lib/api";
import type { WorkspaceSnapshot } from "@/lib/report-tasks";
import { ReportCenter } from "./report-center";
import { GesttaSyncDialog } from "./gestta-sync-dialog";
import { HistoryView } from "./history-view";
import { ApiTokensPanel } from "./api-tokens-panel";
import { DashboardView } from "./dashboard-view";

/**
 * Abas do workspace, na ordem do menu. Para acrescentar uma view, inclua um
 * item aqui (o tipo `View` é derivado deste array) e renderize-a em <main>.
 */
const navigation = [
  {
    id: "dashboard",
    label: "Painel",
    icon: LayoutDashboard,
    title: "Painel",
    description:
      "Tarefas pendentes e atrasadas, extratos que os clientes ainda não enviaram e a situação do Google Drive.",
  },
  {
    id: "reports",
    label: "Relatórios",
    icon: FileBarChart2,
    title: "Central de relatórios",
    description:
      "Veja as tarefas que chegaram do Gestta, o que mudou e o que precisa da sua atenção.",
  },
  {
    id: "history",
    label: "Histórico",
    icon: History,
    title: "Histórico Gestta & Google Drive",
    description:
      "Consulte relatórios e tarefas resgatados automaticamente do Gestta e salvos no Google Drive.",
  },
  {
    id: "integrations",
    label: "Integrações",
    icon: SlidersHorizontal,
    title: "Integrações & Conexões",
    description:
      "Conecte o Gestta e o Google Drive, sincronize as tarefas e gerencie os tokens de API.",
  },
] as const;
type View = (typeof navigation)[number]["id"];
const initialView: View = "dashboard";
const empty: WorkspaceSnapshot = { reports: [], activities: [], tasks: [] };

export function Workspace() {
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<WorkspaceSnapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [sidebar, setSidebar] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [clock, setClock] = useState("");
  const [googleStatus, setGoogleStatus] = useState<{
    connected: boolean;
    email?: string | null;
    lastTestedAt?: string | null;
  } | null>(null);
  const [googleTesting, setGoogleTesting] = useState(false);
  const [googleFiles, setGoogleFiles] = useState<
    Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>
  >([]);

  const [currentUser, setCurrentUser] = useState<{
    email: string;
    name: string;
  } | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      if (res.ok) {
        const d = await res.json();
        if (d.authenticated && d.user) {
          setCurrentUser(d.user);
        }
      }
    } catch {
      // silencioso
    }
  }, []);

  const [gesttaStatus, setGesttaStatus] = useState<{
    connected: boolean;
    companyName?: string;
    companyCnpj?: string;
    userName?: string;
    email?: string;
    totalCustomers?: number;
    lastTestedAt?: string | null;
  } | null>(null);
  const [gesttaTesting, setGesttaTesting] = useState(false);
  const [gesttaSyncOpen, setGesttaSyncOpen] = useState(false);

  const checkGesttaStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/gestta/status", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setGesttaStatus(data);
      }
    } catch {
      // silencioso
    }
  }, []);

  async function testGesttaConnection() {
    setGesttaTesting(true);
    try {
      const res = await fetch("/api/integrations/gestta/connect", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setToast({ text: "Conexão com Gestta validada com sucesso!" });
        void checkGesttaStatus();
      } else {
        setToast({ text: data.error || "Falha ao conectar Gestta.", error: true });
      }
    } catch {
      setToast({ text: "Erro ao comunicar com o Gestta.", error: true });
    } finally {
      setGesttaTesting(false);
    }
  }

  async function disconnectGestta() {
    if (!confirm("Deseja desconectar a integração com o Gestta?")) return;
    try {
      await fetch("/api/integrations/gestta/disconnect", { method: "POST" });
      setToast({ text: "Gestta desconectado." });
      setGesttaStatus({ connected: false });
    } catch {
      setToast({ text: "Erro ao desconectar Gestta.", error: true });
    }
  }

  const checkGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/google/status", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setGoogleStatus(data);
      }
    } catch {
      // silencioso
    }
  }, []);

  async function handleLogout() {
    if (!confirm("Deseja realmente sair da plataforma?")) return;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  const refresh = useCallback(async () => {
    const result = await api<WorkspaceSnapshot>("/workspace");
    setData({
      reports: result.reports ?? [],
      activities: result.activities ?? [],
      tasks: result.tasks ?? [],
    });
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      await refresh();
    } catch {
      setLoadError(
        "Não foi possível conectar à API. Verifique se o servidor está em execução e tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  }, [refresh]);
  useEffect(() => {
    void load();
    void checkGoogleStatus();
    void checkGesttaStatus();
    void checkSession();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("google") === "connected") {
        setToast({ text: "Google Drive conectado com sucesso!" });
        setView("reports");
        window.history.replaceState({}, "", window.location.pathname);
      } else if (params.get("google") === "error") {
        setToast({
          text:
            params.get("message") || "Erro ao autenticar com o Google Drive.",
          error: true,
        });
        setView("reports");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    setClock(
      new Intl.DateTimeFormat("pt-BR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date()),
    );
  }, [load, checkGoogleStatus, checkGesttaStatus, checkSession]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebar(false);
        setActivityOpen(false);
        setHelpOpen(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  function navigate(next: View) {
    setView(next);
    setSidebar(false);
  }
  async function downloadReport(reportId: string) {
    try {
      const res = await api<{ url: string; name: string }>(
        `/reports/${reportId}/download`,
      );
      if (res?.url) {
        window.open(res.url, "_blank");
      }
    } catch (e) {
      setToast({
        text:
          e instanceof Error
            ? e.message
            : "Não foi possível baixar o arquivo do relatório.",
        error: true,
      });
    }
  }
  async function testGoogleConnection() {
    setGoogleTesting(true);
    try {
      const res = await fetch("/api/integrations/google/test", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setToast({
          text: `Conexão validada! ${data.filesCount} arquivos encontrados no Drive.`,
        });
        setGoogleFiles(data.files || []);
        void checkGoogleStatus();
      } else {
        setToast({
          text: data.error || "Falha no teste do Google Drive",
          error: true,
        });
      }
    } catch {
      setToast({
        text: "Erro ao comunicar com o Google Drive.",
        error: true,
      });
    } finally {
      setGoogleTesting(false);
    }
  }
  async function disconnectGoogle() {
    if (!confirm("Deseja realmente desconectar o Google Drive?")) return;
    try {
      const res = await fetch("/api/integrations/google/disconnect", {
        method: "POST",
      });
      if (res.ok) {
        setToast({ text: "Google Drive desconectado." });
        setGoogleStatus({ connected: false });
        setGoogleFiles([]);
      }
    } catch {
      setToast({ text: "Erro ao desconectar.", error: true });
    }
  }
  const current = navigation.find((n) => n.id === view) ?? navigation[0];

  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Fechar menu"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? "sidebar-open" : ""}`}>
        <a className="brand" href="/" aria-label="Mega CRM, início">
          <span className="brand-symbol">
            <svg
              width="25"
              height="25"
              viewBox="0 0 40 40"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 30V10l13 13 13-13v20M7 10l13 20 13-20"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            mega<span className="brand-crm">CRM</span>
          </span>
          <span className="brand-dot" />
        </a>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Navegação principal">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => navigate(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {view === id && <ChevronRight size={13} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="help-button"
            onClick={() => setHelpOpen(!helpOpen)}
            aria-expanded={helpOpen}
          >
            <CircleHelp size={17} />
            Ajuda rápida
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="profile-avatar">
              {currentUser?.name ? currentUser.name[0].toUpperCase() : "M"}
            </span>
            <div style={{ overflow: "hidden", minWidth: 0 }}>
              <strong style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                {currentUser?.name || "Equipe Mega"}
              </strong>
              <small style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                {currentUser?.email || "Mega Contabilidade"}
              </small>
            </div>
            <div className="profile-actions">
              <span className="online-dot" title="Online" />
              <button
                type="button"
                className="logout-btn"
                onClick={handleLogout}
                title="Sair da plataforma"
                aria-label="Sair"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="google-status-pill"
              onClick={() => navigate("integrations")}
              title={
                gesttaStatus?.connected
                  ? `Gestta: ${gesttaStatus.companyName || "Mega Contabilidade"} (${gesttaStatus.totalCustomers || 514} clientes)`
                  : "Conectar Gestta"
              }
            >
              <Building2 size={15} />
              <span>
                {gesttaStatus?.connected
                  ? `Gestta: ${gesttaStatus.totalCustomers || 514} clientes`
                  : "Conectar Gestta"}
              </span>
              <span
                className={
                  gesttaStatus?.connected ? "online-dot" : "dot-disconnected"
                }
              />
            </button>
            <button
              type="button"
              className="google-status-pill"
              onClick={() => navigate("integrations")}
              title={
                googleStatus?.connected
                  ? `Google Drive conectado (${googleStatus.email || ""})`
                  : "Conectar Google Drive"
              }
            >
              <FolderOpen size={15} />
              <span>
                {googleStatus?.connected ? "Drive Conectado" : "Conectar Google Drive"}
              </span>
              <span
                className={
                  googleStatus?.connected ? "online-dot" : "dot-disconnected"
                }
              />
            </button>
            <div className="top-divider" />
            <span className="top-date">{clock}</span>
            <div className="top-divider" />
            <div className="activity-container">
              <button
                className={`notification-button ${activityOpen ? "selected" : ""}`}
                aria-label="Atividades recentes"
                aria-expanded={activityOpen}
                onClick={() => setActivityOpen(!activityOpen)}
              >
                <Bell size={19} />
                {data.activities.length > 0 && <i />}
              </button>
              {activityOpen && (
                <div className="activity-popover">
                  <h3>Atividades recentes</h3>
                  <Activities items={data.activities.slice(0, 5)} />
                </div>
              )}
            </div>
            <span className="top-avatar">M</span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="section-kicker">
                <span />
                GESTTA · GOOGLE DRIVE
              </div>
              <h1>
                {current.title}
                <span className="title-dot">.</span>
              </h1>
              <p>{current.description}</p>
            </div>
            <div className="heading-actions">
              {googleStatus?.connected ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigate("integrations")}
                  style={{
                    borderColor: "rgba(91, 206, 176, 0.4)",
                    background: "rgba(91, 206, 176, 0.08)",
                    color: "#5bceb0",
                  }}
                >
                  <Check size={16} />
                  Drive Conectado
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    window.location.href = "/api/integrations/google/connect";
                  }}
                  style={{
                    borderColor: "rgba(171, 137, 250, 0.4)",
                    background: "rgba(171, 137, 250, 0.12)",
                    color: "#e5def5",
                  }}
                >
                  <FolderOpen size={16} />
                  Conectar Google Drive
                </button>
              )}
            </div>
          </div>
          <div className="demo-strip">
            <span>
              <i />
              Sistema Ativo
            </span>
            <p>
              Supabase PostgreSQL, Storage e Google Drive OAuth 2.0 integrados.
            </p>
            <span className="demo-version">PRODUÇÃO</span>
          </div>
          {loadError && (
            <div className="load-error-banner" role="alert">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <CircleX size={18} color="#f87171" />
                <span>{loadError}</span>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => void load()}
                style={{ color: "#fca5a5" }}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {loading ? (
            <div className="load-state" role="status">
              <LoaderCircle className="spin" size={25} />
              <h2>Preparando seu workspace</h2>
              <p>Carregando relatórios e tarefas…</p>
            </div>
          ) : (
            <>
              {view === "dashboard" && (
                <section className="dashboard-section" style={{ width: "100%" }}>
                  <DashboardView />
                </section>
              )}
              {view === "reports" && (
                <section className="reports-section">
                  <ReportCenter
                    reports={data.reports}
                    tasks={data.tasks}
                    onSync={() =>
                      gesttaStatus?.connected
                        ? setGesttaSyncOpen(true)
                        : navigate("integrations")
                    }
                    onDownload={downloadReport}
                    onRefresh={refresh}
                    onUpdated={(report) => setData(current => ({
                      ...current,
                      reports: current.reports.map(r => r.id === report.id ? report : r),
                    }))}
                  />
                  <div
                    className="surface"
                    style={{
                      marginTop: "24px",
                      padding: "24px",
                      border: "1px solid var(--line)",
                      borderRadius: "14px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: "16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: "14px",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            width: "46px",
                            height: "46px",
                            borderRadius: "12px",
                            background:
                              "linear-gradient(135deg, rgba(171, 137, 250, 0.2), rgba(114, 206, 177, 0.15))",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--purple)",
                            border: "1px solid rgba(171, 137, 250, 0.3)",
                            flexShrink: 0,
                          }}
                        >
                          <FolderOpen size={24} />
                        </div>
                        <div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                            }}
                          >
                            <h3
                              style={{
                                margin: 0,
                                fontSize: "16px",
                                fontWeight: 600,
                              }}
                            >
                              Google Drive
                            </h3>
                            {googleStatus?.connected ? (
                              <span className="valid-tag">
                                <Check size={12} /> Conectado
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: "11px",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  background: "rgba(255,255,255,0.06)",
                                  color: "var(--muted)",
                                }}
                              >
                                Desconectado
                              </span>
                            )}
                          </div>
                          <p
                            style={{
                              margin: "4px 0 0 0",
                              color: "var(--muted)",
                              fontSize: "13px",
                            }}
                          >
                            {googleStatus?.connected
                              ? `Conta conectada: ${googleStatus.email || "Google Drive"} · Renovação automática ativa`
                              : "Conecte sua conta do Google Drive para enviar os relatórios e documentos do Gestta diretamente."}
                          </p>
                        </div>
                      </div>
                      <div>
                        {googleStatus?.connected ? (
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              type="button"
                              className="primary-button"
                              style={{ padding: "8px 14px", fontSize: "13px" }}
                              onClick={testGoogleConnection}
                              disabled={googleTesting}
                            >
                              {googleTesting ? (
                                <LoaderCircle size={15} className="spinner" />
                              ) : (
                                <RefreshCw size={15} />
                              )}
                              {googleTesting ? "Testando..." : "Testar conexão"}
                            </button>
                            <button
                              type="button"
                              style={{
                                padding: "8px 14px",
                                background: "rgba(248, 113, 113, 0.1)",
                                color: "#f87171",
                                border: "1px solid rgba(248, 113, 113, 0.25)",
                                borderRadius: "8px",
                                fontSize: "13px",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                              onClick={disconnectGoogle}
                            >
                              <LogOut size={14} /> Desconectar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="primary-button"
                            style={{ padding: "10px 18px" }}
                            onClick={() => {
                              window.location.href =
                                "/api/integrations/google/connect";
                            }}
                          >
                            <FolderOpen size={16} />
                            Conectar Google Drive
                            <ArrowUpRight size={15} />
                          </button>
                        )}
                      </div>
                    </div>

                    {googleStatus?.connected && googleStatus.lastTestedAt && (
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--muted)",
                          marginTop: "12px",
                          paddingTop: "10px",
                          borderTop: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        Última verificação bem-sucedida:{" "}
                        {new Date(googleStatus.lastTestedAt).toLocaleString(
                          "pt-BR",
                        )}
                      </div>
                    )}

                    {googleFiles.length > 0 && (
                      <div
                        style={{
                          marginTop: "18px",
                          borderTop: "1px solid var(--line)",
                          paddingTop: "14px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 600,
                            marginBottom: "10px",
                            color: "#eeeef5",
                          }}
                        >
                          Arquivos recentes encontrados no Google Drive (
                          {googleFiles.length}):
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                            maxHeight: "220px",
                            overflowY: "auto",
                          }}
                        >
                          {googleFiles.map((file) => (
                            <div
                              key={file.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "8px 12px",
                                borderRadius: "6px",
                                background: "rgba(255,255,255,0.03)",
                                fontSize: "12px",
                              }}
                            >
                              <span
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                <FileSpreadsheet
                                  size={15}
                                  color="var(--purple)"
                                />
                                <strong>{file.name}</strong>
                              </span>
                              {file.webViewLink && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    color: "var(--purple)",
                                  }}
                                >
                                  Abrir no Drive <ExternalLink size={12} />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}
              {view === "integrations" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                  {/* Card Gestta Contabilidade */}
                  <section
                    className="surface"
                    style={{
                      padding: "28px",
                      borderRadius: "16px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: "20px",
                        marginBottom: "20px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: "16px",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            width: "54px",
                            height: "54px",
                            borderRadius: "14px",
                            background:
                              "linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(147, 51, 234, 0.2))",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#34d399",
                            border: "1px solid rgba(52, 211, 153, 0.35)",
                            flexShrink: 0,
                          }}
                        >
                          <Building2 size={30} />
                        </div>
                        <div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                            }}
                          >
                            <h2
                              style={{
                                margin: 0,
                                fontSize: "20px",
                                fontWeight: 600,
                              }}
                            >
                              Gestta Contabilidade
                            </h2>
                            {gesttaStatus?.connected ? (
                              <span className="valid-tag">
                                <Check size={14} /> Conectado
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: "12px",
                                  padding: "4px 10px",
                                  borderRadius: "6px",
                                  background: "rgba(255,255,255,0.06)",
                                  color: "var(--muted)",
                                }}
                              >
                                Desconectado
                              </span>
                            )}
                          </div>
                          <p
                            style={{
                              margin: "6px 0 0 0",
                              color: "var(--muted)",
                              fontSize: "14px",
                            }}
                          >
                            Plataforma oficial de gestão contábil, empresas e tarefas fiscais da Mega Contabilidade.
                          </p>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          flexWrap: "wrap",
                        }}
                      >
                        {gesttaStatus?.connected ? (
                          <>
                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => setGesttaSyncOpen(true)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "10px 18px",
                                fontSize: "14px",
                                background: "linear-gradient(135deg, #10b981, #059669)",
                                border: "none",
                                boxShadow: "0 4px 12px rgba(16, 185, 129, 0.25)",
                              }}
                            >
                              <FolderSync size={16} />
                              Sincronizar no Google Drive
                            </button>
                            <a
                              href="https://app.gestta.com.br/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="secondary-button"
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "10px 14px",
                                fontSize: "14px",
                                textDecoration: "none",
                              }}
                            >
                              Acessar Gestta <ExternalLink size={14} />
                            </a>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={testGesttaConnection}
                              disabled={gesttaTesting}
                              style={{ padding: "10px 14px", fontSize: "14px" }}
                            >
                              <RefreshCw
                                size={15}
                                className={gesttaTesting ? "spin-icon" : ""}
                              />
                              Testar
                            </button>
                            <button
                              type="button"
                              onClick={disconnectGestta}
                              style={{
                                padding: "10px 14px",
                                background: "rgba(248, 113, 113, 0.1)",
                                color: "#f87171",
                                border: "1px solid rgba(248, 113, 113, 0.25)",
                                borderRadius: "8px",
                                fontSize: "14px",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                cursor: "pointer",
                              }}
                            >
                              <LogOut size={15} /> Desconectar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="primary-button"
                            onClick={testGesttaConnection}
                            disabled={gesttaTesting}
                            style={{ padding: "12px 24px", fontSize: "15px" }}
                          >
                            <Building2 size={18} />
                            Conectar Gestta
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Detalhes da Conexão Gestta */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "14px",
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid var(--line)",
                        borderRadius: "10px",
                        padding: "16px 20px",
                      }}
                    >
                      <div>
                        <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                          Empresa Conectada
                        </span>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginTop: "4px" }}>
                          {gesttaStatus?.companyName || "MEGA CONTABILIDADE"}
                        </div>
                        {gesttaStatus?.companyCnpj && (
                          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                            CNPJ: {gesttaStatus.companyCnpj}
                          </span>
                        )}
                      </div>

                      <div>
                        <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                          Usuário Gestta
                        </span>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginTop: "4px" }}>
                          {gesttaStatus?.userName || "Rodrigo Ferreira"}
                        </div>
                        <span style={{ fontSize: "12px", color: "var(--purple)" }}>
                          {gesttaStatus?.email || "financeiro@megacontabilidade.com"}
                        </span>
                      </div>

                      <div>
                        <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                          Carteira de Clientes
                        </span>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#34d399", marginTop: "2px" }}>
                          {gesttaStatus?.totalCustomers || 514} empresas
                        </div>
                        <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                          Disponíveis para sincronização
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Card Google Drive */}
                  <section
                    className="surface"
                    style={{
                      padding: "28px",
                      borderRadius: "16px",
                      border: "1px solid var(--line)",
                    }}
                  >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: "20px",
                      marginBottom: "28px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: "16px",
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          width: "54px",
                          height: "54px",
                          borderRadius: "14px",
                          background:
                            "linear-gradient(135deg, rgba(171, 137, 250, 0.2), rgba(114, 206, 177, 0.2))",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--purple)",
                          border: "1px solid rgba(171, 137, 250, 0.35)",
                          flexShrink: 0,
                        }}
                      >
                        <FolderOpen size={30} />
                      </div>
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          <h2
                            style={{
                              margin: 0,
                              fontSize: "20px",
                              fontWeight: 600,
                            }}
                          >
                            Google Drive
                          </h2>
                          {googleStatus?.connected ? (
                            <span className="valid-tag">
                              <Check size={14} /> Conectado
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: "12px",
                                padding: "4px 10px",
                                borderRadius: "6px",
                                background: "rgba(255,255,255,0.06)",
                                color: "var(--muted)",
                              }}
                            >
                              Desconectado
                            </span>
                          )}
                        </div>
                        <p
                          style={{
                            margin: "6px 0 0 0",
                            color: "var(--muted)",
                            fontSize: "14px",
                          }}
                        >
                          {googleStatus?.connected
                            ? `Conta vinculada: ${googleStatus.email || "Google Drive"} · Tokens salvos e renovados automaticamente no Supabase.`
                            : "Conecte sua conta do Google Drive via OAuth 2.0 Web para enviar os relatórios e documentos do Gestta diretamente."}
                        </p>
                      </div>
                    </div>
                    <div>
                      {googleStatus?.connected ? (
                        <div style={{ display: "flex", gap: "10px" }}>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={testGoogleConnection}
                            disabled={googleTesting}
                          >
                            {googleTesting ? (
                              <LoaderCircle size={16} className="spinner" />
                            ) : (
                              <RefreshCw size={16} />
                            )}
                            {googleTesting
                              ? "Testando..."
                              : "Testar acesso ao Drive"}
                          </button>
                          <button
                            type="button"
                            onClick={disconnectGoogle}
                            style={{
                              padding: "10px 16px",
                              background: "rgba(248, 113, 113, 0.1)",
                              color: "#f87171",
                              border: "1px solid rgba(248, 113, 113, 0.25)",
                              borderRadius: "8px",
                              fontSize: "14px",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              cursor: "pointer",
                            }}
                          >
                            <LogOut size={15} /> Desconectar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="primary-button"
                          style={{ padding: "12px 24px", fontSize: "15px" }}
                          onClick={() => {
                            window.location.href =
                              "/api/integrations/google/connect";
                          }}
                        >
                          <FolderOpen size={18} />
                          Conectar Google Drive
                          <ArrowUpRight size={17} />
                        </button>
                      )}
                    </div>
                  </div>

                  {googleStatus?.connected && (
                    <div
                      style={{
                        marginTop: "20px",
                        paddingTop: "20px",
                        borderTop: "1px solid var(--line)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "14px",
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "15px",
                            fontWeight: 600,
                          }}
                        >
                          Arquivos recentes no Google Drive ({googleFiles.length})
                        </h3>
                        {googleStatus.lastTestedAt && (
                          <span
                            style={{ fontSize: "12px", color: "var(--muted)" }}
                          >
                            Última verificação:{" "}
                            {new Date(googleStatus.lastTestedAt).toLocaleString(
                              "pt-BR",
                            )}
                          </span>
                        )}
                      </div>
                      {googleFiles.length === 0 ? (
                        <p
                          style={{ color: "var(--muted)", fontSize: "13px" }}
                        >
                          Nenhum arquivo listado ainda. Clique em "Testar acesso ao Drive" acima para sincronizar a lista de arquivos.
                        </p>
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(280px, 1fr))",
                            gap: "12px",
                          }}
                        >
                          {googleFiles.map((file) => (
                            <div
                              key={file.id}
                              style={{
                                padding: "12px 16px",
                                borderRadius: "8px",
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid var(--line)",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  overflow: "hidden",
                                }}
                              >
                                <FileSpreadsheet
                                  size={18}
                                  color="var(--purple)"
                                  style={{ flexShrink: 0 }}
                                />
                                <span
                                  style={{
                                    fontSize: "13px",
                                    fontWeight: 500,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                  title={file.name}
                                >
                                  {file.name}
                                </span>
                              </div>
                              {file.webViewLink && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    color: "var(--purple)",
                                    fontSize: "12px",
                                    flexShrink: 0,
                                    marginLeft: "8px",
                                  }}
                                >
                                  Abrir <ExternalLink size={12} />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!googleStatus?.connected && (
                    <div
                      style={{
                        marginTop: "24px",
                        padding: "20px",
                        borderRadius: "10px",
                        background: "rgba(255,255,255,0.02)",
                        border: "1px dashed var(--line)",
                      }}
                    >
                      <h4
                        style={{
                          margin: "0 0 10px 0",
                          fontSize: "14px",
                          fontWeight: 600,
                          color: "#fff",
                        }}
                      >
                        Como funciona a integração:
                      </h4>
                      <ol
                        style={{
                          margin: 0,
                          paddingLeft: "20px",
                          color: "var(--muted)",
                          fontSize: "13px",
                          lineHeight: "1.9",
                        }}
                      >
                        <li>
                          Clique em <strong>Conectar Google Drive</strong> acima.
                        </li>
                        <li>
                          Faça login e autorize a permissão de leitura de arquivos e planilhas no Google.
                        </li>
                        <li>
                          O Google retorna para o sistema e seus tokens de acesso são salvos de forma segura no Supabase.
                        </li>
                        <li>
                          A renovação do token ocorre automaticamente em segundo plano, sem necessidade de novo login.
                        </li>
                      </ol>
                    </div>
                  )}
                  </section>

                  <ApiTokensPanel
                    onMessage={(text, error) => setToast({ text, error })}
                  />
                </div>
              )}
              {view === "history" && (
                <section className="history-section" style={{ width: "100%" }}>
                  <HistoryView />
                </section>
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>
              MEGA CRM <i /> Relatórios do Gestta organizados no Google Drive.
            </span>
            <span>
              Mega Contabilidade <ArrowUpRight size={12} />
            </span>
          </footer>
        </main>
      </div>
      <GesttaSyncDialog
        open={gesttaSyncOpen}
        onClose={() => setGesttaSyncOpen(false)}
        onSuccess={() => {
          void refresh();
          setToast({
            text: "Tarefas do Gestta sincronizadas e enviadas ao Google Drive com sucesso!",
          });
        }}
      />
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleX size={19} /> : <Check size={19} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="Fechar notificação"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {helpOpen && (
        <div className="help-popover">
          <button
            className="icon-button"
            aria-label="Fechar ajuda"
            onClick={() => setHelpOpen(false)}
          >
            <X size={17} />
          </button>
          <span className="eyebrow">COMECE POR AQUI</span>
          <h3>Gestta → Google Drive, passo a passo</h3>
          <ol>
            <li>
              Em <strong>Integrações</strong>, conecte o Gestta e o Google
              Drive.
            </li>
            <li>
              Use <strong>Sincronizar no Google Drive</strong> para buscar as
              tarefas e documentos do Gestta e enviá-los ao Drive.
            </li>
            <li>
              Acompanhe cada sincronização em <strong>Relatórios</strong>{" "}
              (tarefas, documentos pendentes e dúvidas) e consulte tudo por
              empresa em <strong>Histórico</strong>.
            </li>
          </ol>
          <p>
            Os dados ficam no Supabase (Postgres & Storage) e os arquivos no
            Google Drive, organizados por Empresa / Competência / Tarefa.
          </p>
        </div>
      )}
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <FolderOpen size={27} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Activities({ items }: { items: Activity[] }) {
  return items.length ? (
    <div className="activities">
      {items.map((a) => (
        <div className="activity-row" key={a.id}>
          <span className="activity-mark">
            <ArrowUpRight size={14} />
          </span>
          <div>
            <strong>{a.company}</strong>
            <p>{a.description}</p>
          </div>
          <small>
            {new Date(a.createdAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        </div>
      ))}
    </div>
  ) : (
    <Empty
      title="Nenhuma atividade ainda"
      text="As sincronizações do Gestta com o Google Drive aparecerão aqui."
    />
  );
}
