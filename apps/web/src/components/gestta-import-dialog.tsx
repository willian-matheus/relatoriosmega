"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Search,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { owners } from "@mega/contracts";
import { Dialog } from "./dialog";

type Priority = "low" | "medium" | "high";

interface GesttaCustomer {
  id: string;
  name: string;
  cnpj?: string;
  code?: string;
  active?: boolean;
}

interface GesttaImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

export function GesttaImportDialog({
  open,
  onClose,
  onSuccess,
}: GesttaImportDialogProps) {
  const [customers, setCustomers] = useState<GesttaCustomer[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [owner, setOwner] = useState<string>("Ana Martins");
  const [priority, setPriority] = useState<Priority>("medium");
  const [error, setError] = useState<string | null>(null);

  const loadCustomers = useCallback(
    async (targetPage: number, query: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: "15",
          search: query,
        });
        const res = await fetch(`/api/integrations/gestta/customers?${params}`);
        if (!res.ok) {
          throw new Error("Não foi possível carregar a lista de clientes.");
        }
        const data = await res.json();
        setCustomers(data.customers || []);
        setTotalPages(data.pages || 1);
        setTotalCount(data.total || 0);
        setPage(data.page || targetPage);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erro ao carregar clientes",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) {
      void loadCustomers(1, search);
    } else {
      setSelectedIds(new Set());
      setSearch("");
    }
  }, [open, loadCustomers]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    void loadCustomers(1, search);
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  }

  function toggleSelectAllPage() {
    const next = new Set(selectedIds);
    const allSelected = customers.every((c) => next.has(c.id));
    if (allSelected) {
      customers.forEach((c) => next.delete(c.id));
    } else {
      customers.forEach((c) => next.add(c.id));
    }
    setSelectedIds(next);
  }

  async function handleImport() {
    if (selectedIds.size === 0) return;
    setImporting(true);
    setError(null);

    try {
      const selectedCustomers = customers.filter((c) => selectedIds.has(c.id));
      const res = await fetch("/api/integrations/gestta/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customers: selectedCustomers,
          owner,
          priority,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Falha ao importar clientes.");
      }

      onSuccess(data.importedCount);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro durante a importação.",
      );
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  const allSelectedOnCurrentPage =
    customers.length > 0 && customers.every((c) => selectedIds.has(c.id));

  return (
    <Dialog
      title="Sincronizar Clientes do Gestta"
      subtitle={`Selecione clientes da base da Mega Contabilidade (${totalCount} disponíveis) para adicionar como oportunidades no pipeline.`}
      onClose={onClose}
      wide
    >
      <div className="gestta-import-dialog-body" style={{ minWidth: "320px" }}>
        {error && (
          <div className="login-error-banner" style={{ marginBottom: "16px" }}>
            <AlertCircle size={16} className="login-error-icon" />
            <span>{error}</span>
          </div>
        )}

        {/* Barra de Busca e Configuração */}
        <form
          onSubmit={handleSearchSubmit}
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "16px",
          }}
        >
          <div
            className="login-input-box"
            style={{ flex: 1, position: "relative" }}
          >
            <Search
              size={16}
              style={{
                position: "absolute",
                left: "12px",
                color: "var(--muted)",
              }}
            />
            <input
              type="text"
              placeholder="Buscar por nome, código ou CNPJ..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px 10px 38px",
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: "13px",
                outline: "none",
              }}
            />
          </div>
          <button
            type="submit"
            className="button secondary"
            disabled={loading}
            style={{ padding: "0 16px", fontSize: "13px" }}
          >
            Buscar
          </button>
        </form>

        {/* Configurações padrão de importação */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            background: "rgba(255, 255, 255, 0.02)",
            padding: "12px 16px",
            borderRadius: "8px",
            border: "1px solid var(--line)",
            marginBottom: "16px",
          }}
        >
          <div>
            <label
              style={{
                fontSize: "11px",
                color: "var(--muted)",
                display: "block",
                marginBottom: "4px",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Responsável Comercial
            </label>
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              style={{
                width: "100%",
                background: "rgba(10, 12, 18, 0.9)",
                color: "#fff",
                border: "1px solid var(--line)",
                borderRadius: "6px",
                padding: "8px 10px",
                fontSize: "13px",
              }}
            >
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                fontSize: "11px",
                color: "var(--muted)",
                display: "block",
                marginBottom: "4px",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Prioridade no CRM
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              style={{
                width: "100%",
                background: "rgba(10, 12, 18, 0.9)",
                color: "#fff",
                border: "1px solid var(--line)",
                borderRadius: "6px",
                padding: "8px 10px",
                fontSize: "13px",
              }}
            >
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </select>
          </div>
        </div>

        {/* Tabela / Lista de Clientes */}
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "8px",
            overflow: "hidden",
            maxHeight: "360px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: "rgba(255, 255, 255, 0.04)",
              borderBottom: "1px solid var(--line)",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={allSelectedOnCurrentPage}
                onChange={toggleSelectAllPage}
              />
              <span>Selecionar Todos da Página</span>
            </label>
            <span style={{ color: "var(--purple)" }}>
              {selectedIds.size} selecionado(s)
            </span>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "40px 0",
                  gap: "10px",
                  color: "var(--muted)",
                  fontSize: "13px",
                }}
              >
                <Loader2 size={20} className="spin-icon" />
                <span>Carregando clientes do Gestta...</span>
              </div>
            ) : customers.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  color: "var(--muted)",
                  fontSize: "13px",
                }}
              >
                Nenhum cliente encontrado para os critérios de busca.
              </div>
            ) : (
              customers.map((c) => {
                const isSelected = selectedIds.has(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggleSelect(c.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                      cursor: "pointer",
                      background: isSelected
                        ? "rgba(147, 51, 234, 0.12)"
                        : "transparent",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        overflow: "hidden",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // handled by parent div onClick
                        style={{ cursor: "pointer" }}
                      />
                      <Building2
                        size={17}
                        color={isSelected ? "var(--purple)" : "var(--muted)"}
                        style={{ flexShrink: 0 }}
                      />
                      <div style={{ overflow: "hidden" }}>
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "#fff",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {c.name}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--muted)",
                            display: "flex",
                            gap: "8px",
                          }}
                        >
                          {c.code && <span>Cód: {c.code}</span>}
                          {c.cnpj && <span>CNPJ: {c.cnpj}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Paginação */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "12px",
            fontSize: "12px",
            color: "var(--muted)",
          }}
        >
          <span>
            Página {page} de {totalPages} ({totalCount} empresas)
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              className="button secondary"
              disabled={page <= 1 || loading}
              onClick={() => void loadCustomers(page - 1, search)}
              style={{ padding: "4px 8px" }}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={page >= totalPages || loading}
              onClick={() => void loadCustomers(page + 1, search)}
              style={{ padding: "4px 8px" }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Rodapé com Ações */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "20px",
            paddingTop: "16px",
            borderTop: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={importing}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button primary"
            onClick={handleImport}
            disabled={selectedIds.size === 0 || importing}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {importing ? (
              <>
                <Loader2 size={16} className="spin-icon" />
                <span>Importando...</span>
              </>
            ) : (
              <>
                <Check size={16} />
                <span>
                  Importar {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}{" "}
                  para Novos Leads
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
