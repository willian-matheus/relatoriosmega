"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@megacrm.com");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Por favor, digite a sua senha de acesso.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || "admin@megacrm.com",
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Senha incorreta ou acesso não autorizado.");
        setLoading(false);
        return;
      }

      // Redireciona para o Workspace com recarregamento limpo para ativar middleware e estado
      const params = new URLSearchParams(window.location.search);
      const destination = params.get("from") || "/";
      window.location.href = destination;
    } catch (err) {
      setError("Erro de comunicação com o servidor. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="login-wrapper">
      <div className="login-background-glow" />
      <div className="login-background-glow-secondary" />

      <div className="login-container">
        {/* Card Principal */}
        <div className="login-card">
          <div className="login-header">
            <div className="login-brand">
              <div className="brand-badge login-badge">
                <span>M</span>
              </div>
              <span className="login-brand-name">MEGA CRM</span>
            </div>

            <div className="login-security-tag">
              <ShieldCheck size={14} />
              <span>Ambiente Comercial Protegido</span>
            </div>

            <h1 className="login-title">Acesse a plataforma</h1>
            <p className="login-subtitle">
              Entre com sua conta Gestta (Mega Contabilidade) ou com as credenciais do sistema.
            </p>
          </div>

          {error && (
            <div className="login-error-banner" role="alert">
              <AlertCircle size={17} className="login-error-icon" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="login-email">Usuário ou E-mail</label>
              <div className="login-input-box">
                <Mail size={17} className="login-input-icon" />
                <input
                  id="login-email"
                  type="text"
                  placeholder="financeiro@megacontabilidade.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="login-field">
              <div className="login-field-header">
                <label htmlFor="login-password">Senha de Acesso</label>
                <span className="login-field-hint">Gestta ou mega2026</span>
              </div>
              <div className="login-input-box">
                <Lock size={17} className="login-input-icon" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Digite sua senha..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="login-toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Ocultar senha" : "Ver senha"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="login-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="spin-icon" />
                  <span>Autenticando...</span>
                </>
              ) : (
                <>
                  <span>Acessar Plataforma</span>
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          <div className="login-footer">
            <div className="login-tip">
              <Sparkles size={14} />
              <span>
                Acesso com credencial Gestta (<code>financeiro@megacontabilidade.com</code>) ou senha da plataforma (<code>mega2026</code>).
              </span>
            </div>
          </div>
        </div>

        <div className="login-bottom-credits">
          Mega CRM · Integrado com Gestta Contabilidade & Google Drive
        </div>
      </div>
    </div>
  );
}
