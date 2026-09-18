"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Opportunity,
  OpportunityInput,
  owners,
  Stage,
  stages,
  WorkspaceData,
} from "@mega/contracts";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleX,
  FileBarChart2,
  FileSpreadsheet,
  FolderOpen,
  LayoutDashboard,
  LayoutGrid,
  List,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
  X,
  ExternalLink,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { dateLabel, initials, localDate, money } from "@/lib/format";
import { Kanban } from "./kanban";
import { OpportunityDialog } from "./opportunity-dialog";
import { ImportDialog } from "./import-dialog";

type View = "overview" | "pipeline" | "reports" | "contacts";
const navigation = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "pipeline", label: "Pipeline", icon: LayoutGrid },
  { id: "reports", label: "Relatórios", icon: FileBarChart2 },
  { id: "contacts", label: "Contatos", icon: Users },
] as const;
const empty: WorkspaceData = { opportunities: [], reports: [], activities: [] };

export function Workspace() {
  const [view, setView] = useState<View>("pipeline");
  const [data, setData] = useState<WorkspaceData>(empty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [priority, setPriority] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [mode, setMode] = useState<"board" | "list">("board");
  const [editor, setEditor] = useState<{
    item?: Opportunity;
    stage: Stage;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [sidebar, setSidebar] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [clock, setClock] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
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

  const refresh = useCallback(async () => {
    const result = await api<WorkspaceData>("/workspace");
    setData(result);
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
  }, [load, checkGoogleStatus]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
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
    setQuery("");
    setOwner("all");
    setPriority("all");
  }
  async function save(input: OpportunityInput, id?: string) {
    await api(id ? `/opportunities/${id}` : "/opportunities", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(input),
    });
    await refresh();
    setToast({
      text: id
        ? "Oportunidade atualizada."
        : "Oportunidade adicionada ao pipeline.",
    });
  }
  async function remove(id: string) {
    await api(`/opportunities/${id}`, { method: "DELETE" });
    await refresh();
    setToast({ text: "Oportunidade excluída." });
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
  async function move(id: string, stage: Stage) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    const previous = data;
    setData((d) => ({
      ...d,
      opportunities: d.opportunities.map((o) =>
        o.id === id ? { ...o, stage } : o,
      ),
    }));
    try {
      await api(`/opportunities/${id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      });
      await refresh();
      setToast({
        text: `Oportunidade movida para ${stages.find((s) => s.id === stage)?.label.toLowerCase()}.`,
      });
    } catch (e) {
      setData(previous);
      setToast({
        text: e instanceof Error ? e.message : "Não foi possível mover.",
        error: true,
      });
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  const opportunities = data.opportunities;
  const filtered = opportunities.filter(
    (o) =>
      `${o.company} ${o.contact} ${o.email}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")) &&
      (owner === "all" || o.owner === owner) &&
      (priority === "all" || o.priority === priority),
  );
  const open = opportunities.filter((o) => o.stage !== "won");
  const won = opportunities.filter((o) => o.stage === "won");
  const total = open.reduce((sum, o) => sum + o.value, 0);
  const wonValue = won.reduce((sum, o) => sum + o.value, 0);
  const rate = opportunities.length
    ? Math.round((won.length / opportunities.length) * 100)
    : 0;
  const disabled = loading || !!loadError;

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
        <div className="workspace-switch">
          <span className="workspace-initial">M</span>
          <div>
            <strong>Workspace Mega</strong>
            <small>Equipe comercial</small>
          </div>
        </div>
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
              {id === "pipeline" && (
                <span className="nav-count">{opportunities.length}</span>
              )}
              {view === id && id !== "pipeline" && <ChevronRight size={13} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="team-heading">
          <span className="nav-label">SEU TIME</span>
          <span className="team-total">3</span>
        </div>
        <div className="team-list">
          {owners.map((name, i) => (
            <button
              key={name}
              onClick={() => {
                setView("pipeline");
                setOwner(name);
                setSidebar(false);
                setShowFilters(true);
              }}
            >
              <span className={`avatar avatar-${i}`}>{initials(name)}</span>
              <span>{name}</span>
              <i />
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="demo-card">
            <span>
              <Sparkles size={15} />
              Espaço de demonstração
            </span>
            <p>
              Seu próximo negócio
              <br />
              começa com uma boa conexão.
            </p>
            <div>
              <i />
              Dados temporários em memória
            </div>
          </div>
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
            <span className="profile-avatar">M</span>
            <div>
              <strong>Equipe Mega</strong>
              <small>Workspace comercial</small>
            </div>
            <span className="online-dot" />
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
            <strong>{navigation.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="topbar-right">
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
                SEU ESPAÇO DE CRESCIMENTO
              </div>
              <h1>
                {view === "pipeline"
                  ? "Pipeline de vendas"
                  : view === "overview"
                    ? "Visão geral"
                    : view === "reports"
                      ? "Central de relatórios"
                      : "Seus contatos"}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {view === "pipeline"
                  ? "Cada conversa, uma oportunidade. Acompanhe o próximo passo."
                  : view === "overview"
                    ? "Uma visão clara do que está acontecendo no seu comercial."
                    : view === "reports"
                      ? "Transforme seus relatórios em novas oportunidades."
                      : "Pessoas e empresas que fazem parte do seu pipeline."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary-button"
                disabled={disabled}
                onClick={() => setImportOpen(true)}
              >
                <ArrowDownToLine size={16} />
                Importar relatório
              </button>
              <button
                className="primary-button"
                disabled={disabled}
                onClick={() => setEditor({ stage: "new" })}
              >
                <Plus size={17} />
                Nova oportunidade
              </button>
            </div>
          </div>
          <div className="demo-strip">
            <span>
              <i />
              Modo demonstração
            </span>
            <p>
              Explore o CRM com dados de exemplo. As alterações são temporárias.
            </p>
            <span className="demo-version">PRÉVIA 01</span>
          </div>
          {loading ? (
            <div className="load-state" role="status">
              <LoaderCircle className="spin" size={25} />
              <h2>Preparando seu workspace</h2>
              <p>Carregando oportunidades e relatórios…</p>
            </div>
          ) : loadError ? (
            <div className="load-state" role="alert">
              <CircleX size={28} />
              <h2>Não foi possível carregar o CRM</h2>
              <p>{loadError}</p>
              <button className="primary-button" onClick={() => void load()}>
                Tentar novamente
              </button>
            </div>
          ) : (
            <>
              {(view === "pipeline" || view === "overview") && (
                <section className="stats-grid" aria-label="Resumo comercial">
                  <Metric
                    title="Pipeline em aberto"
                    value={money(total)}
                    foot={`${open.length} oportunidades em andamento`}
                    icon={<Wallet size={18} />}
                    accent="purple"
                    graph
                  />
                  <Metric
                    title="Oportunidades"
                    value={String(opportunities.length).padStart(2, "0")}
                    foot={`${opportunities.filter((o) => o.stage === "new").length} aguardando o primeiro contato`}
                    icon={<Target size={18} />}
                    accent="blue"
                  />
                  <Metric
                    title="Negócios fechados"
                    value={money(wonValue)}
                    foot={`${won.length} relacionamentos que viraram negócio`}
                    icon={<Check size={18} />}
                    accent="green"
                  />
                  <Metric
                    title="Taxa de fechamento"
                    value={`${rate}%`}
                    foot="Fechados sobre o total de oportunidades"
                    icon={<TrendingUp size={18} />}
                    accent="amber"
                    progress={rate}
                  />
                </section>
              )}
              {view === "pipeline" && (
                <section className="pipeline-section">
                  <div className="pipeline-tabs">
                    <div className="pipeline-tab active">
                      <span className="stage-dot" />
                      Funil comercial<span>{opportunities.length}</span>
                    </div>
                    <div className="pipeline-meta">
                      <span className="tiny-dot" />
                      Atualizado nesta sessão
                    </div>
                  </div>
                  <div className="board-toolbar">
                    <div className="board-tools-left">
                      <div className="segmented" aria-label="Visualização">
                        <button
                          className={mode === "board" ? "selected" : ""}
                          aria-label="Visualização em Kanban"
                          aria-pressed={mode === "board"}
                          onClick={() => setMode("board")}
                        >
                          <LayoutGrid size={15} />
                          <span>Kanban</span>
                        </button>
                        <button
                          className={mode === "list" ? "selected" : ""}
                          aria-label="Visualização em lista"
                          aria-pressed={mode === "list"}
                          onClick={() => setMode("list")}
                        >
                          <List size={16} />
                        </button>
                      </div>
                      <span className="toolbar-divider" />
                      <div className="search-field">
                        <Search size={16} />
                        <input
                          ref={searchRef}
                          placeholder="Buscar oportunidade…"
                          aria-label="Buscar oportunidade"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        <kbd>Ctrl K</kbd>
                      </div>
                    </div>
                    <div className="board-tools-right">
                      <div
                        className="team-stack"
                        aria-label="Três responsáveis"
                      >
                        {owners.map((o, i) => (
                          <span
                            key={o}
                            title={o}
                            className={`avatar avatar-${i}`}
                          >
                            {initials(o)}
                          </span>
                        ))}
                        <span className="stack-total">3</span>
                      </div>
                      <button
                        className={`filter-button ${showFilters ? "selected" : ""}`}
                        onClick={() => setShowFilters(!showFilters)}
                        aria-expanded={showFilters}
                      >
                        <SlidersHorizontal size={15} />
                        Filtros
                        {(owner !== "all" || priority !== "all") && (
                          <span className="filter-dot" />
                        )}
                        <ChevronDown size={13} />
                      </button>
                    </div>
                  </div>
                  {showFilters && (
                    <div className="filter-panel">
                      <label>
                        Responsável
                        <select
                          value={owner}
                          onChange={(e) => setOwner(e.target.value)}
                        >
                          <option value="all">Todos os responsáveis</option>
                          {owners.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Prioridade
                        <select
                          value={priority}
                          onChange={(e) => setPriority(e.target.value)}
                        >
                          <option value="all">Todas as prioridades</option>
                          <option value="high">Alta</option>
                          <option value="medium">Média</option>
                          <option value="low">Baixa</option>
                        </select>
                      </label>
                      <button
                        className="text-button"
                        onClick={() => {
                          setOwner("all");
                          setPriority("all");
                          setQuery("");
                        }}
                      >
                        Limpar filtros
                      </button>
                      <span>{filtered.length} oportunidades encontradas</span>
                    </div>
                  )}
                  {mode === "board" ? (
                    <Kanban
                      items={filtered}
                      onOpen={(item) => setEditor({ item, stage: item.stage })}
                      onAdd={(stage) => setEditor({ stage })}
                      onMove={(id, stage) => void move(id, stage)}
                      busy={busy}
                    />
                  ) : (
                    <OpportunityTable
                      items={filtered}
                      onOpen={(item) => setEditor({ item, stage: item.stage })}
                    />
                  )}
                  <div className="board-caption">
                    <span>
                      <GripIcon />
                      Arraste os cartões para mudar de etapa ou abra uma
                      oportunidade para editar.
                    </span>
                    <span>{filtered.length} oportunidades · 5 etapas</span>
                  </div>
                </section>
              )}
              {view === "overview" && (
                <div className="overview-grid">
                  <section className="surface funnel-panel">
                    <div className="surface-heading">
                      <div>
                        <span className="eyebrow">DO CONTATO À CONQUISTA</span>
                        <h2>Seu funil, em números</h2>
                      </div>
                      <BarChart3 size={20} />
                    </div>
                    <div className="funnel-chart">
                      {stages.map((stage) => {
                        const items = opportunities.filter(
                          (o) => o.stage === stage.id,
                        );
                        const max = Math.max(
                          ...stages.map(
                            (s) =>
                              opportunities.filter((o) => o.stage === s.id)
                                .length,
                          ),
                          1,
                        );
                        return (
                          <button
                            key={stage.id}
                            onClick={() => navigate("pipeline")}
                          >
                            <div>
                              <span>{stage.label}</span>
                              <strong>{items.length}</strong>
                            </div>
                            <div className="bar-track">
                              <span
                                style={{
                                  width: `${(items.length / max) * 100}%`,
                                  background: stage.color,
                                }}
                              />
                            </div>
                            <small>
                              {money(
                                items.reduce((sum, o) => sum + o.value, 0),
                              )}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section className="surface">
                    <div className="surface-heading">
                      <div>
                        <span className="eyebrow">PRÓXIMOS PASSOS</span>
                        <h2>Conversas para retomar</h2>
                      </div>
                      <span className="count-pill">
                        {open.filter((o) => o.dueDate <= localDate()).length}
                      </span>
                    </div>
                    {open.filter((o) => o.dueDate <= localDate()).length ===
                    0 ? (
                      <Empty
                        title="Tudo em dia"
                        text="Nenhum contato pendente para hoje."
                      />
                    ) : (
                      open
                        .filter((o) => o.dueDate <= localDate())
                        .map((o) => (
                          <button
                            key={o.id}
                            className="follow-up"
                            onClick={() =>
                              setEditor({ item: o, stage: o.stage })
                            }
                          >
                            <span
                              className={`company-logo logo-${o.company.length % 5}`}
                            >
                              {initials(o.company)}
                            </span>
                            <div>
                              <strong>{o.company}</strong>
                              <small>
                                {o.contact} · {money(o.value)}
                              </small>
                            </div>
                            <span
                              className={
                                o.dueDate < localDate() ? "overdue" : ""
                              }
                            >
                              {o.dueDate === localDate()
                                ? "Hoje"
                                : dateLabel(o.dueDate)}
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))
                    )}
                  </section>
                  <section className="surface recent-surface">
                    <div className="surface-heading">
                      <div>
                        <span className="eyebrow">NO SEU WORKSPACE</span>
                        <h2>Atividade recente</h2>
                      </div>
                      <span className="session-tag">Nesta sessão</span>
                    </div>
                    <Activities items={data.activities.slice(0, 6)} />
                  </section>
                </div>
              )}
              {view === "reports" && (
                <section className="reports-section">
                  <div className="reports-intro">
                    <div className="report-illustration">
                      <div className="illustration-orbit" />
                      <div className="illustration-file">
                        <FileSpreadsheet size={44} />
                        <span />
                        <span />
                        <span />
                      </div>
                      <span className="illustration-badge">
                        <ArrowDownLeft size={21} />
                      </span>
                    </div>
                    <span className="eyebrow">
                      DOS DADOS À PRÓXIMA CONVERSA
                    </span>
                    <h2>
                      Seu relatório tem
                      <br />
                      novas possibilidades.
                    </h2>
                    <p>
                      Traga seus contatos em CSV, confira a prévia
                      <br />e organize cada oportunidade no pipeline.
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => setImportOpen(true)}
                    >
                      <Plus size={17} />
                      Selecionar relatório
                      <ArrowRight size={16} />
                    </button>
                    <span className="report-formats">
                      CSV · Até 500 registros por importação
                    </span>
                  </div>
                  <div className="surface report-history">
                    <div className="surface-heading">
                      <h2>Histórico de importações</h2>
                      <span className="count-pill">{data.reports.length}</span>
                    </div>
                    {data.reports.length === 0 ? (
                      <Empty
                        title="Seus relatórios vão aparecer aqui"
                        text="Após importar, acompanhe o nome, a data e a quantidade de registros de cada arquivo."
                      />
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Relatório</th>
                              <th>Registros</th>
                              <th>Importado em</th>
                              <th>Status</th>
                              <th style={{ textAlign: "right" }}>Arquivo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.reports.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <span className="table-file">
                                    <FileSpreadsheet size={19} />
                                    {r.name}
                                  </span>
                                </td>
                                <td>{r.count}</td>
                                <td>
                                  {new Date(r.createdAt).toLocaleString(
                                    "pt-BR",
                                  )}
                                </td>
                                <td>
                                  <span className="valid-tag">
                                    <Check size={12} />
                                    Importado
                                  </span>
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {r.filePath ? (
                                    <button
                                      type="button"
                                      className="icon-button"
                                      style={{
                                        display: "inline-flex",
                                        padding: "6px",
                                      }}
                                      title="Baixar arquivo original do Storage"
                                      onClick={() => downloadReport(r.id)}
                                    >
                                      <ArrowDownToLine size={16} />
                                    </button>
                                  ) : (
                                    <span style={{ opacity: 0.4 }}>—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
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
                              : "Conecte sua conta do Google Drive para sincronizar e importar relatórios e planilhas diretamente."}
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
              {view === "contacts" && (
                <section className="surface contacts-surface">
                  <div className="surface-heading">
                    <div>
                      <h2>
                        Contatos do pipeline{" "}
                        <span className="count-pill">{filtered.length}</span>
                      </h2>
                      <p>Informações de contato vinculadas às oportunidades.</p>
                    </div>
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        ref={searchRef}
                        placeholder="Buscar nome ou empresa…"
                        aria-label="Buscar contato"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Contato</th>
                          <th>Empresa</th>
                          <th>E-mail</th>
                          <th>Responsável</th>
                          <th>Etapa</th>
                          <th>
                            <span className="sr-only">Ações</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((o) => (
                          <tr key={o.id}>
                            <td>
                              <span className="table-contact">
                                <span className="avatar avatar-1">
                                  {initials(o.contact)}
                                </span>
                                <strong>{o.contact}</strong>
                              </span>
                            </td>
                            <td>{o.company}</td>
                            <td>
                              {o.email ? (
                                <a href={`mailto:${o.email}`}>{o.email}</a>
                              ) : (
                                <span className="muted">Não informado</span>
                              )}
                            </td>
                            <td>{o.owner}</td>
                            <td>
                              <span
                                className="stage-label"
                                style={{
                                  color: stages.find((s) => s.id === o.stage)
                                    ?.color,
                                }}
                              >
                                {stages.find((s) => s.id === o.stage)?.label}
                              </span>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Editar contato ${o.contact}`}
                                onClick={() =>
                                  setEditor({ item: o, stage: o.stage })
                                }
                              >
                                <ArrowUpRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filtered.length === 0 && (
                      <Empty
                        title="Nenhum contato encontrado"
                        text="Tente outra busca ou crie uma oportunidade."
                      />
                    )}
                  </div>
                </section>
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>
              MEGA CRM <i /> Conexões que movem negócios.
            </span>
            <span>
              Feito para o seu próximo passo <ArrowUpRight size={12} />
            </span>
          </footer>
        </main>
      </div>
      {editor && (
        <OpportunityDialog
          opportunity={editor.item}
          stage={editor.stage}
          onClose={() => setEditor(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            await refresh();
            setView("pipeline");
            setQuery("");
            setOwner("all");
            setPriority("all");
            setToast({
              text: "Relatório importado. Os novos contatos já estão no pipeline.",
            });
          }}
        />
      )}
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
          <h3>Seu CRM, passo a passo</h3>
          <ol>
            <li>Crie uma oportunidade ou importe um CSV pelo modelo.</li>
            <li>Arraste pelo ícone no canto do cartão para mudar de etapa.</li>
            <li>
              Para usar o teclado ou celular, abra o cartão e selecione a etapa.
            </li>
          </ol>
          <p>
            Os dados são mantidos apenas enquanto a API está ligada. Banco de
            dados e Google Drive entram depois.
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({
  title,
  value,
  foot,
  icon,
  accent,
  graph,
  progress,
}: {
  title: string;
  value: string;
  foot: string;
  icon: React.ReactNode;
  accent: string;
  graph?: boolean;
  progress?: number;
}) {
  return (
    <article className={`metric metric-${accent}`}>
      <div className="metric-top">
        <span>{title}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <div className="metric-number">
        {value}
        {graph && (
          <svg viewBox="0 0 96 34" aria-hidden="true">
            <defs>
              <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#a78bfa" stopOpacity=".22" />
                <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0 27 L13 23 L25 26 L36 17 L48 19 L60 9 L71 13 L83 5 L95 2 L95 34 L0 34 Z"
              fill="url(#spark-fill)"
            />
            <path
              d="M0 27 L13 23 L25 26 L36 17 L48 19 L60 9 L71 13 L83 5 L95 2"
              stroke="#b098f8"
              strokeWidth="2"
              fill="none"
            />
          </svg>
        )}
      </div>
      {progress !== undefined && (
        <div className="metric-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      <p>{foot}</p>
    </article>
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
      title="Pronto para o primeiro movimento"
      text="Crie, edite ou mova uma oportunidade para acompanhar a atividade aqui."
    />
  );
}
function OpportunityTable({
  items,
  onOpen,
}: {
  items: Opportunity[];
  onOpen: (o: Opportunity) => void;
}) {
  return (
    <div className="table-scroll opportunity-table">
      <table>
        <thead>
          <tr>
            <th>Oportunidade</th>
            <th>Valor</th>
            <th>Etapa</th>
            <th>Responsável</th>
            <th>Próximo contato</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td>
                <strong>{o.company}</strong>
                <small>{o.contact}</small>
              </td>
              <td>{money(o.value)}</td>
              <td>
                <span
                  className="stage-label"
                  style={{ color: stages.find((s) => s.id === o.stage)?.color }}
                >
                  {stages.find((s) => s.id === o.stage)?.label}
                </span>
              </td>
              <td>{o.owner}</td>
              <td>{dateLabel(o.dueDate)}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Abrir ${o.company}`}
                  onClick={() => onOpen(o)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <Empty
          title="Nenhuma oportunidade encontrada"
          text="Ajuste os filtros ou adicione uma nova oportunidade."
        />
      )}
    </div>
  );
}
function GripIcon() {
  return <MoreHorizontal size={15} />;
}
