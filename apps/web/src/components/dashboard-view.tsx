"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileWarning,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Search,
  Table2,
  BarChart3,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import type { DashboardData } from "@/lib/dashboard/aggregate";
import "./dashboard-view.css";

// Séries do gráfico por competência (paleta validada para daltonismo no fundo do app)
const SERIES = [
  { key: "concluidasNoPrazo", label: "Concluídas no prazo", color: "var(--dv-s1)" },
  { key: "concluidasComAtraso", label: "Concluídas com atraso", color: "var(--dv-s2)" },
  { key: "abertasNoPrazo", label: "Em aberto no prazo", color: "var(--dv-s3)" },
  { key: "atrasadas", label: "Atrasadas", color: "var(--dv-s4)" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

const nf = new Intl.NumberFormat("pt-BR");
const fmt = (n: number) => nf.format(n);

function competenceLabel(c: string): string {
  const [y, m] = c.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${months[Number(m) - 1] ?? m}/${y.slice(2)}`;
}

function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// ------------------------------------------------------------------ peças

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "critical" | "good" }) {
  return (
    <div className={`dv-kpi ${tone ? `dv-kpi-${tone}` : ""}`}>
      <span className="dv-kpi-label">
        {tone === "critical" && <AlertTriangle size={13} aria-hidden />}
        {tone === "good" && <CheckCircle2 size={13} aria-hidden />}
        {label}
      </span>
      <strong className="dv-kpi-value">{value}</strong>
      {hint && <span className="dv-kpi-hint">{hint}</span>}
    </div>
  );
}

function Card({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="dv-card">
      <header className="dv-card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (t: boolean) => void }) {
  return (
    <div className="dv-toggle" role="group" aria-label="Forma de exibição">
      <button type="button" className={!table ? "active" : ""} aria-pressed={!table} onClick={() => onChange(false)} title="Gráfico">
        <BarChart3 size={14} aria-hidden /> Gráfico
      </button>
      <button type="button" className={table ? "active" : ""} aria-pressed={table} onClick={() => onChange(true)} title="Tabela">
        <Table2 size={14} aria-hidden /> Tabela
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ gráfico por competência (barras empilhadas)

/** Largura real do elemento: o gráfico é desenhado nessa largura para o texto não encolher nem crescer. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function CompetenceChart({ serie }: { serie: DashboardData["serie"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useWidth<HTMLDivElement>(1100);
  const H = W < 600 ? 240 : 320;
  const pad = { top: 16, right: 8, bottom: 34, left: W < 600 ? 36 : 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const totals = serie.map((p) => SERIES.reduce((s, x) => s + (p[x.key as SeriesKey] as number), 0));
  const max = Math.max(1, ...totals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const slot = innerW / Math.max(1, serie.length);
  const barW = Math.min(56, slot * 0.5);
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;

  return (
    <div className="dv-chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="dv-svg" role="img" aria-label="Tarefas por competência, por situação">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? "dv-baseline" : "dv-grid"} />
            <text x={pad.left - 8} y={y(t) + 4} className="dv-tick" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {serie.map((p, i) => {
          const cx = pad.left + slot * i + slot / 2;
          let acc = 0;
          const segs = SERIES.map((s) => {
            const v = p[s.key as SeriesKey] as number;
            const y0 = y(acc);
            acc += v;
            const y1 = y(acc);
            return { s, v, y0, y1 };
          }).filter((x) => x.v > 0);
          return (
            <g key={p.competencia}>
              {segs.map(({ s, y0, y1 }, j) => {
                const isTop = j === segs.length - 1;
                const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2)); // 2px de respiro entre segmentos
                return isTop ? (
                  <path key={s.key} d={roundedTop(cx - barW / 2, y1, barW, h, 4)} fill={s.color} />
                ) : (
                  <rect key={s.key} x={cx - barW / 2} y={y1 + 2} width={barW} height={h} fill={s.color} />
                );
              })}
              <text x={cx} y={H - pad.bottom + 18} className="dv-tick" textAnchor="middle">
                {competenceLabel(p.competencia)}
              </text>
              {/* área de toque maior que a barra */}
              <rect
                x={pad.left + slot * i}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${competenceLabel(p.competencia)}: ${SERIES.map((s) => `${s.label} ${p[s.key as SeriesKey]}`).join(", ")}`}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && serie[hover] && (
        <div className="dv-tooltip" style={{ left: `${((pad.left + slot * hover + slot / 2) / W) * 100}%` }}>
          <strong>{competenceLabel(serie[hover].competencia)}</strong>
          {SERIES.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} aria-hidden />
              {s.label}
              <b>{fmt(serie[hover][s.key as SeriesKey] as number)}</b>
            </span>
          ))}
          <span className="dv-tooltip-total">
            Total <b>{fmt(totals[hover])}</b>
          </span>
        </div>
      )}
    </div>
  );
}

function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

// ------------------------------------------------------------------ ranking (barras horizontais, uma medida)

function RankingBars({ items, measure, unit }: { items: { id: string; label: string; value: number; extra: string }[]; measure: string; unit: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="dv-empty">Nenhuma pendência.</p>;
  return (
    <ol className="dv-rank" aria-label={measure}>
      {items.map((i) => (
        <li key={i.id} title={`${i.label}: ${i.value} ${unit} · ${i.extra}`}>
          <span className="dv-rank-label">{i.label}</span>
          <span className="dv-rank-track">
            <span className="dv-rank-bar" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </span>
          <span className="dv-rank-value">
            {fmt(i.value)}
            <small>{i.extra}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ painel

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [competencias, setCompetencias] = useState(6);
  const [responsavel, setResponsavel] = useState("");
  const [owners, setOwners] = useState<string[]>([]);
  const [seriesTable, setSeriesTable] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ competencias: String(competencias) });
      if (responsavel) qs.set("responsavel", responsavel);
      if (refresh) qs.set("refresh", "1");
      const d = await api<DashboardData>(`/dashboard?${qs}`, { signal: AbortSignal.timeout(90_000) });
      setData(d);
      // lista de responsáveis vem do painel sem filtro (para o filtro não sumir com as opções)
      if (!responsavel) setOwners(d.ranking.responsaveis.map((r) => r.nome).filter(Boolean));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o painel.");
    } finally {
      setLoading(false);
    }
  }, [competencias, responsavel]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendencias = useMemo(() => {
    if (!data) return [];
    const q = docSearch.trim().toLowerCase();
    return data.documentos.pendencias.filter(
      (p) =>
        (!onlyOverdue || p.vencido) &&
        (!q || `${p.empresaNome} ${p.empresaCodigo ?? ""} ${p.competencia ?? ""}`.toLowerCase().includes(q)),
    );
  }, [data, docSearch, onlyOverdue]);

  if (loading && !data) {
    return (
      <div className="dv-state" role="status">
        <LoaderCircle className="spin" size={24} aria-hidden />
        <p>Calculando o painel…</p>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="dv-state dv-state-error" role="alert">
        <XCircle size={22} aria-hidden />
        <p>{error}</p>
        <button type="button" className="secondary-button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </div>
    );
  }
  if (!data) return null;

  const k = data.kpis;
  const docs = data.documentos;
  const drive = data.drive;
  const last = drive.ultimaSincronizacao;
  const semRetrato = data.retrato.tarefas === 0;

  return (
    <div className="dv-root">
      {/* filtros em uma linha, acima dos gráficos */}
      <div className="dv-filters">
        <label>
          Período
          <select value={competencias} onChange={(e) => setCompetencias(Number(e.target.value))}>
            <option value={3}>Últimas 3 competências</option>
            <option value={6}>Últimas 6 competências</option>
            <option value={12}>Últimas 12 competências</option>
          </select>
        </label>
        <label>
          Responsável
          <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="">Todos</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <span className="dv-updated">
          Dados do Gestta de {dateTime(data.retrato.sincronizadoEm)}
        </span>
        <button type="button" className="secondary-button" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} aria-hidden /> Atualizar
        </button>
      </div>

      {semRetrato && (
        <p className="dv-notice">
          <CircleDashed size={15} aria-hidden /> Ainda não há tarefas do Gestta registradas. Elas aparecem após a próxima
          captura automática (ou em Integrações → sincronizar).
        </p>
      )}

      {/* números principais */}
      <div className="dv-kpis">
        <Kpi label="Tarefas em aberto" value={fmt(k.emAberto)} hint={`de ${fmt(k.total)} no período`} />
        <Kpi label="Atrasadas" value={fmt(k.atrasadas)} hint="em aberto e vencidas" tone={k.atrasadas ? "critical" : undefined} />
        <Kpi label="Concluídas" value={fmt(k.concluidas)} hint={`${fmt(k.concluidasComAtraso)} com atraso`} />
        <Kpi
          label="Concluídas no prazo"
          value={k.percentualNoPrazo === null ? "—" : `${Math.round(k.percentualNoPrazo)}%`}
          hint="das concluídas"
          tone={k.percentualNoPrazo !== null && k.percentualNoPrazo >= 90 ? "good" : undefined}
        />
        <Kpi
          label="Clientes sem extrato"
          value={fmt(docs.totais.tarefasSemExtratoVencidas)}
          hint={`tarefa vencida · +${fmt(docs.totais.tarefasParciais)} enviaram só parte`}
          tone={docs.totais.tarefasSemExtratoVencidas ? "critical" : undefined}
        />
        <Kpi label="Extratos no Drive" value={fmt(drive.extratos.comCopiaDrive)} hint={`de ${fmt(drive.extratos.total)} capturados`} />
      </div>

      {/* evolução por competência */}
      <Card
        title="Evolução por competência"
        subtitle="Situação das tarefas do Gestta em cada competência"
        actions={<ViewToggle table={seriesTable} onChange={setSeriesTable} />}
      >
        <ul className="dv-legend" aria-label="Legenda">
          {SERIES.map((s) => (
            <li key={s.key}>
              <i style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        {seriesTable ? (
          <div className="dv-table-wrap">
            <table className="dv-table">
              <thead>
                <tr>
                  <th>Competência</th>
                  {SERIES.map((s) => (
                    <th key={s.key} className="num">{s.label}</th>
                  ))}
                  <th className="num">Desconsideradas</th>
                </tr>
              </thead>
              <tbody>
                {data.serie.map((p) => (
                  <tr key={p.competencia}>
                    <td>{competenceLabel(p.competencia)}</td>
                    {SERIES.map((s) => (
                      <td key={s.key} className="num">{fmt(p[s.key as SeriesKey] as number)}</td>
                    ))}
                    <td className="num">{fmt(p.desconsideradas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <CompetenceChart serie={data.serie} />
        )}
      </Card>

      <div className="dv-grid2">
        <Card title="Empresas com mais atrasos" subtitle="Tarefas atrasadas (em aberto entre parênteses)">
          <RankingBars
            measure="Empresas por tarefas atrasadas"
            unit="atrasadas"
            items={data.ranking.empresas.slice(0, 8).map((e, i) => ({
              id: e.id ?? `empresa-${i}`,
              label: `${e.codigo ? `${e.codigo} · ` : ""}${e.nome}`,
              value: e.atrasadas,
              extra: `(${fmt(e.emAberto)} em aberto)`,
            }))}
          />
        </Card>
        <Card title="Responsáveis com mais atrasos" subtitle="Tarefas atrasadas (em aberto entre parênteses)">
          <RankingBars
            measure="Responsáveis por tarefas atrasadas"
            unit="atrasadas"
            items={data.ranking.responsaveis.slice(0, 8).map((r, i) => ({
              id: r.id ?? `responsavel-${i}`,
              label: r.nome || "Sem responsável",
              value: r.atrasadas,
              extra: `(${fmt(r.emAberto)} em aberto)`,
            }))}
          />
        </Card>
      </div>

      {/* documentos não enviados */}
      <Card
        title="Extratos não enviados pelos clientes"
        subtitle="Clientes que ainda não enviaram os extratos pedidos nas tarefas em aberto (tarefas concluídas não entram)"
        actions={
          <label className="dv-search">
            <Search size={14} aria-hidden />
            <input placeholder="Buscar empresa ou competência" value={docSearch} onChange={(e) => setDocSearch(e.target.value)} aria-label="Buscar empresa ou competência" />
          </label>
        }
      >
        <div className="dv-doc-totals">
          <span><b>{fmt(docs.totais.solicitados)}</b> solicitados</span>
          <span><b>{fmt(docs.totais.recebidos)}</b> recebidos</span>
          <span className="dv-doc-missing"><FileWarning size={14} aria-hidden /><b>{fmt(docs.totais.tarefasSemExtrato)}</b> clientes sem nenhum extrato</span>
          <span><b>{fmt(docs.totais.tarefasParciais)}</b> enviaram só parte</span>
          <span className="dv-muted"><b>{fmt(docs.totais.faltandoVencidos)}</b> itens vencidos · <b>{fmt(docs.totais.faltandoAVencer)}</b> a vencer</span>
          <label className="dv-check">
            <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
            Mostrar só tarefas vencidas
          </label>
        </div>
        <div className="dv-doc-totals">
          {docs.porCompetencia.map((g) => (
            <span key={g.competencia ?? "sem"} className="dv-chip">
              {g.competencia ? competenceLabel(g.competencia) : "sem competência"}: {fmt(g.faltando)} itens faltando ({fmt(g.faltandoVencidos)} vencidos)
            </span>
          ))}
        </div>
        {pendencias.length ? (
          <div className="dv-table-wrap dv-table-scroll">
            <table className="dv-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Competência</th>
                  <th>Situação</th>
                  <th>Extratos faltando</th>
                  <th>Vencimento da tarefa</th>
                </tr>
              </thead>
              <tbody>
                {pendencias.slice(0, 200).map((p) => (
                  <tr key={p.tarefaId}>
                    <td>{p.empresaCodigo ? `${p.empresaCodigo} · ` : ""}{p.empresaNome}</td>
                    <td>{p.competencia ? competenceLabel(p.competencia) : "—"}</td>
                    <td>
                      {p.recebidos === 0 ? (
                        <span className="dv-badge-none">Nenhum enviado</span>
                      ) : (
                        <span className="dv-badge-partial">Parcial ({fmt(p.recebidos)} de {fmt(p.solicitados)})</span>
                      )}
                    </td>
                    <td>{p.documentosFaltantes.map((d) => d.replace(/\s*\(.*\)\s*$/, "")).join("; ")}</td>
                    <td>
                      {dateOnly(p.vencimento)}
                      {p.vencido && <span className="dv-badge-late"><AlertTriangle size={11} aria-hidden /> vencida</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pendencias.length > 200 && <p className="dv-more">Mostrando 200 de {fmt(pendencias.length)}. Use a busca para refinar.</p>}
          </div>
        ) : (
          <p className="dv-empty">{docSearch ? "Nada encontrado para a busca." : onlyOverdue ? "Nenhum extrato atrasado." : "Nenhum extrato faltando."}</p>
        )}
      </Card>

      {/* situação do Drive */}
      <Card title="Situação do Google Drive e dos envios" subtitle="Arquivos salvos, pendentes e últimas sincronizações">
        <div className="dv-drive">
          <div className="dv-drive-block">
            <h4><HardDrive size={14} aria-hidden /> Extratos</h4>
            <dl>
              <div><dt>Capturados</dt><dd>{fmt(drive.extratos.total)} <small>({fmt(drive.extratos.ofx)} OFX · {fmt(drive.extratos.pdf)} PDF)</small></dd></div>
              <div><dt>Com cópia no Drive</dt><dd>{fmt(drive.extratos.comCopiaDrive)}</dd></div>
              <div><dt>Sem cópia no Drive</dt><dd className={drive.extratos.semCopiaDrive ? "dv-warn" : ""}>{fmt(drive.extratos.semCopiaDrive)}</dd></div>
              <div><dt>Convertidos de PDF</dt><dd>{fmt(drive.extratos.convertidos)}</dd></div>
              <div><dt>Última captura</dt><dd>{dateTime(drive.extratos.ultimaCaptura)}</dd></div>
            </dl>
          </div>
          <div className="dv-drive-block">
            <h4><FileWarning size={14} aria-hidden /> Relatórios de tarefas</h4>
            <dl>
              <div><dt>Tarefas no histórico</dt><dd>{fmt(drive.historico.tarefas)}</dd></div>
              <div><dt>Com PDF no Drive</dt><dd>{fmt(drive.historico.comPdfNoDrive)}</dd></div>
              <div><dt>Com arquivo no Drive</dt><dd>{fmt(drive.historico.comArquivoNoDrive)}</dd></div>
            </dl>
            <h4 className="dv-mt"><Clock3 size={14} aria-hidden /> Envio ao CRM-MEGA</h4>
            <dl>
              <div><dt>Enviados</dt><dd>{fmt(drive.envioCrm.enviado)}</dd></div>
              <div><dt>Pendentes</dt><dd>{fmt(drive.envioCrm.pendente)}</dd></div>
              <div><dt>Não enviados (duplicariam)</dt><dd>{fmt(drive.envioCrm.nao_enviar)}</dd></div>
              <div><dt>Com erro</dt><dd className={drive.envioCrm.erro ? "dv-warn" : ""}>{fmt(drive.envioCrm.erro)}</dd></div>
            </dl>
          </div>
          <div className="dv-drive-block">
            <h4><RefreshCw size={14} aria-hidden /> Sincronizações</h4>
            {last ? (
              <p className="dv-last">
                <SyncStatus status={last.status} /> {dateTime(last.inicio)}
                {last.erro && <span className="dv-error-text">{last.erro}</span>}
              </p>
            ) : (
              <p className="dv-empty">Nenhuma sincronização registrada.</p>
            )}
            <ul className="dv-runs">
              {drive.execucoes.slice(0, 6).map((r, i) => (
                <li key={r.id ?? i}>
                  <SyncStatus status={r.status} />
                  <span>{dateTime(r.inicio)}</span>
                  <span className="dv-muted">
                    {r.tarefasVerificadas ?? 0} tarefas{r.duracaoSegundos != null ? ` · ${Math.round(r.duracaoSegundos)}s` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SyncStatus({ status }: { status: string | null }) {
  if (status === "success")
    return <span className="dv-status dv-status-good"><CheckCircle2 size={13} aria-hidden /> Sucesso</span>;
  if (status === "error")
    return <span className="dv-status dv-status-critical"><XCircle size={13} aria-hidden /> Erro</span>;
  return <span className="dv-status dv-status-warning"><LoaderCircle size={13} aria-hidden /> Em andamento</span>;
}
