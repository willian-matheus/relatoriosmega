import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getOptionalSupabaseServerClient } from "./supabase-server";

export const API_TOKEN_PREFIX = "mega_";
export const STATEMENTS_READ_SCOPE = "extratos:read";
/** Permite ENVIAR extratos para o relatoriosmega (POST /api/public/v1/extratos) */
export const STATEMENTS_WRITE_SCOPE = "extratos:write";
export const ALLOWED_SCOPES = [STATEMENTS_READ_SCOPE, STATEMENTS_WRITE_SCOPE] as const;

/** Valida e normaliza as permissões pedidas (padrão: só leitura). */
export function normalizeScopes(scopes: unknown): string[] {
  if (scopes === undefined || scopes === null) return [STATEMENTS_READ_SCOPE];
  if (!Array.isArray(scopes) || !scopes.length) {
    throw new Error("Escolha ao menos uma permissão para o token.");
  }
  const unique = [...new Set(scopes.map(String))];
  const invalid = unique.filter((s) => !(ALLOWED_SCOPES as readonly string[]).includes(s));
  if (invalid.length) throw new Error(`Permissão inválida: ${invalid.join(", ")}.`);
  return ALLOWED_SCOPES.filter((s) => unique.includes(s));
}

export interface ApiTokenInfo {
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

interface ApiTokenRow {
  id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string[];
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

// Fallback em memória quando o Supabase não está configurado
const memoryTokens = new Map<string, ApiTokenRow>();

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function toInfo(row: ApiTokenRow): ApiTokenInfo {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scopes: row.scopes || [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

export async function listApiTokens(): Promise<ApiTokenInfo[]> {
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    return [...memoryTokens.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(toInfo);
  }
  const { data, error } = await (supabase as any)
    .from("api_tokens")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Não foi possível listar os tokens: ${error.message}`);
  return (data as ApiTokenRow[]).map(toInfo);
}

/**
 * Gera um novo token. O valor completo só é retornado aqui; no banco fica apenas o hash.
 */
export async function createApiToken(input: {
  name: string;
  expiresInDays?: number | null;
  createdBy?: string | null;
  scopes?: unknown;
}): Promise<{ token: string; info: ApiTokenInfo }> {
  const scopes = normalizeScopes(input.scopes);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new Error("Informe um nome entre 2 e 80 caracteres.");
  }
  const days = input.expiresInDays;
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
    throw new Error("A validade deve ser um número inteiro de dias entre 1 e 3650.");
  }

  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const row: ApiTokenRow = {
    id: randomUUID(),
    name,
    token_hash: hashApiToken(token),
    token_prefix: token.slice(0, API_TOKEN_PREFIX.length + 6),
    scopes,
    created_by: input.createdBy || null,
    created_at: now.toISOString(),
    expires_at: days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null,
    revoked_at: null,
    last_used_at: null,
  };

  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    memoryTokens.set(row.id, row);
    return { token, info: toInfo(row) };
  }
  const { error } = await (supabase as any).from("api_tokens").insert(row);
  if (error) throw new Error(`Não foi possível criar o token: ${error.message}`);
  return { token, info: toInfo(row) };
}

export async function revokeApiToken(id: string): Promise<void> {
  const revokedAt = new Date().toISOString();
  const supabase = getOptionalSupabaseServerClient();
  if (!supabase) {
    const row = memoryTokens.get(id);
    if (!row) throw new Error("Token não encontrado.");
    row.revoked_at ??= revokedAt;
    return;
  }
  const { data, error } = await (supabase as any)
    .from("api_tokens")
    .update({ revoked_at: revokedAt })
    .eq("id", id)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`Não foi possível revogar o token: ${error.message}`);
  if (!data?.length) throw new Error("Token não encontrado ou já revogado.");
}

/**
 * Extrai o token do cabeçalho `Authorization: Bearer <token>` ou `X-API-Key`.
 */
export function readApiTokenFromHeaders(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const match = auth.match(/^Bearer\s+(\S+)$/i);
    if (match) return match[1];
  }
  const apiKey = headers.get("x-api-key");
  return apiKey?.trim() || null;
}

export type ApiTokenVerification =
  | { ok: true; token: ApiTokenInfo }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Valida o token recebido de uma plataforma externa e registra o último uso.
 */
export async function verifyApiToken(
  rawToken: string | null,
  requiredScope: string,
): Promise<ApiTokenVerification> {
  if (!rawToken || !rawToken.startsWith(API_TOKEN_PREFIX)) {
    return {
      ok: false,
      status: 401,
      error: "Token ausente ou inválido. Envie 'Authorization: Bearer <token>'.",
    };
  }

  const hash = hashApiToken(rawToken);
  const supabase = getOptionalSupabaseServerClient();
  let row: ApiTokenRow | null = null;

  if (!supabase) {
    row = [...memoryTokens.values()].find((t) => t.token_hash === hash) || null;
  } else {
    const { data, error } = await (supabase as any)
      .from("api_tokens")
      .select("*")
      .eq("token_hash", hash)
      .maybeSingle();
    if (error) {
      console.error("Erro ao validar token de API:", error.message);
      return { ok: false, status: 401, error: "Não foi possível validar o token." };
    }
    row = data;
  }

  if (!row) return { ok: false, status: 401, error: "Token inválido." };
  if (row.revoked_at) return { ok: false, status: 401, error: "Token revogado." };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, error: "Token expirado." };
  }
  if (!row.scopes?.includes(requiredScope)) {
    return { ok: false, status: 403, error: `O token não tem a permissão '${requiredScope}'.` };
  }

  const usedAt = new Date().toISOString();
  if (!supabase) {
    row.last_used_at = usedAt;
  } else {
    // Registro de uso não deve bloquear nem derrubar a requisição
    void (supabase as any)
      .from("api_tokens")
      .update({ last_used_at: usedAt })
      .eq("id", row.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn("Aviso ao registrar uso do token:", error.message);
      });
  }

  return { ok: true, token: toInfo({ ...row, last_used_at: usedAt }) };
}
