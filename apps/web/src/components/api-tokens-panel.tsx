"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function tokenStatus(t: ApiTokenInfo): { label: string; active: boolean } {
  if (t.revokedAt) return { label: "Revogado", active: false };
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) {
    return { label: "Expirado", active: false };
  }
  return { label: "Ativo", active: true };
}

export function ApiTokensPanel({
  onMessage,
}: {
  onMessage: (text: string, error?: boolean) => void;
}) {
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("365");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api<{ tokens: ApiTokenInfo[] }>("/api-tokens");
      setTokens(data.tokens);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar tokens.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const data = await api<{ token: string; info: ApiTokenInfo }>("/api-tokens", {
        method: "POST",
        body: JSON.stringify({
          name,
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        }),
      });
      setNewToken(data.token);
      setCopied(false);
      setName("");
      setTokens((prev) => [data.info, ...prev]);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Erro ao criar token.", true);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(t: ApiTokenInfo) {
    if (!confirm(`Revogar o token "${t.name}"? A plataforma que o usa perderá o acesso imediatamente.`)) {
      return;
    }
    try {
      await api(`/api-tokens/${t.id}`, { method: "DELETE" });
      onMessage(`Token "${t.name}" revogado.`);
      void load();
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Erro ao revogar token.", true);
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      onMessage("Não foi possível copiar. Selecione o token e copie manualmente.", true);
    }
  }

  const baseUrl = `${origin || ""}/api/public/v1/extratos`;

  return (
    <section
      className="surface"
      style={{ padding: "28px", borderRadius: "16px", border: "1px solid var(--line)" }}
    >
      <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "20px" }}>
        <div
          style={{
            width: "54px",
            height: "54px",
            borderRadius: "14px",
            background: "rgba(171, 137, 250, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--purple)",
            border: "1px solid rgba(171, 137, 250, 0.35)",
            flexShrink: 0,
          }}
        >
          <KeyRound size={28} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
            Tokens de API · Extratos OFX e PDF
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13px" }}>
            Gere um token para que outras plataformas busquem os extratos anexados às tarefas do
            Gestta.
          </p>
        </div>
      </div>

      <form
        onSubmit={create}
        style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", flex: "1 1 220px" }}>
          Nome da plataforma
          <input
            required
            minLength={2}
            maxLength={80}
            placeholder="Ex.: Sistema de conciliação"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
          Validade
          <select
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            disabled={creating}
          >
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
            <option value="365">1 ano</option>
            <option value="">Sem expiração</option>
          </select>
        </label>
        <button type="submit" className="primary-button" disabled={creating}>
          {creating ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
          Gerar token
        </button>
      </form>

      {newToken && (
        <div
          role="status"
          style={{
            marginTop: "18px",
            padding: "16px",
            borderRadius: "12px",
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(52, 211, 153, 0.35)",
          }}
        >
          <strong style={{ fontSize: "14px" }}>Copie o token agora — ele não será exibido novamente.</strong>
          <div style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
            <code
              style={{
                flex: "1 1 300px",
                padding: "10px 12px",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                wordBreak: "break-all",
                userSelect: "all",
              }}
            >
              {newToken}
            </code>
            <button type="button" className="secondary-button" onClick={copyToken}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copiado" : "Copiar"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setNewToken(null)}>
              Concluído
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: "22px", overflowX: "auto" }}>
        {loading ? (
          <p style={{ color: "var(--muted)", fontSize: "13px" }}>Carregando tokens…</p>
        ) : loadError ? (
          <p className="form-error">{loadError}</p>
        ) : tokens.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "13px" }}>Nenhum token gerado ainda.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "8px" }}>Nome</th>
                <th style={{ padding: "8px" }}>Token</th>
                <th style={{ padding: "8px" }}>Status</th>
                <th style={{ padding: "8px" }}>Criado em</th>
                <th style={{ padding: "8px" }}>Expira em</th>
                <th style={{ padding: "8px" }}>Último uso</th>
                <th style={{ padding: "8px" }} aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const status = tokenStatus(t);
                return (
                  <tr key={t.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px" }}>{t.name}</td>
                    <td style={{ padding: "8px" }}>
                      <code>{t.prefix}…</code>
                    </td>
                    <td style={{ padding: "8px", color: status.active ? "#34d399" : "var(--muted)" }}>
                      {status.label}
                    </td>
                    <td style={{ padding: "8px" }}>{formatDate(t.createdAt)}</td>
                    <td style={{ padding: "8px" }}>{t.expiresAt ? formatDate(t.expiresAt) : "Nunca"}</td>
                    <td style={{ padding: "8px" }}>{formatDate(t.lastUsedAt)}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      {!t.revokedAt && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Revogar token ${t.name}`}
                          title="Revogar"
                          onClick={() => revoke(t)}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <details style={{ marginTop: "20px", fontSize: "13px", color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer", color: "var(--text)" }}>Como a plataforma usa o token</summary>
        <pre
          style={{
            marginTop: "10px",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(0,0,0,0.3)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
{`# Listar extratos (filtros opcionais: formato, competencia, cnpj, desde, pagina, limite)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${baseUrl}?formato=ofx&competencia=2026-10"

# Baixar um arquivo (use o downloadUrl retornado na listagem)
curl -H "Authorization: Bearer <TOKEN>" -OJ \\
  "${baseUrl}/<ID>/download"`}
        </pre>
      </details>
    </section>
  );
}
