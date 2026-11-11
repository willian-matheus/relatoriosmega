-- ============================================================================
-- Migration: 20261110000000_create_api_tokens_and_statements.sql
-- Descrição: Tokens de API para plataformas externas e extratos (OFX/PDF)
--            capturados dos anexos das tarefas do Gestta.
--
-- Segurança: as duas tabelas e o bucket NÃO têm políticas para anon/authenticated.
-- Somente a chave de serviço (SUPABASE_SERVICE_ROLE_KEY) acessa esses dados.
-- ============================================================================

-- 1. Tokens de API emitidos pelo CRM
CREATE TABLE IF NOT EXISTS public.api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  token_hash TEXT NOT NULL UNIQUE,          -- SHA-256 (hex) do token; o token em si nunca é salvo
  token_prefix TEXT NOT NULL,               -- primeiros caracteres, apenas para identificação visual
  scopes TEXT[] NOT NULL DEFAULT ARRAY['extratos:read'],
  created_by TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_created_at ON public.api_tokens (created_at DESC);

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

-- 2. Extratos bancários (OFX/PDF) anexados às tarefas do Gestta
CREATE TABLE IF NOT EXISTS public.gestta_statement_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gestta_document_id TEXT NOT NULL UNIQUE,
  gestta_task_id TEXT NOT NULL,
  task_name TEXT,
  company_name TEXT NOT NULL,
  company_code TEXT,
  company_cnpj TEXT,
  competence TEXT,
  format TEXT NOT NULL CHECK (format IN ('ofx', 'pdf')),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_statement_files_synced_at ON public.gestta_statement_files (synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_statement_files_competence ON public.gestta_statement_files (competence);
CREATE INDEX IF NOT EXISTS idx_statement_files_cnpj ON public.gestta_statement_files (company_cnpj);
CREATE INDEX IF NOT EXISTS idx_statement_files_task ON public.gestta_statement_files (gestta_task_id);

DROP TRIGGER IF EXISTS set_statement_files_updated_at ON public.gestta_statement_files;
CREATE TRIGGER set_statement_files_updated_at
BEFORE UPDATE ON public.gestta_statement_files
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.gestta_statement_files ENABLE ROW LEVEL SECURITY;

-- 3. Bucket privado para os arquivos de extrato
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'statements',
  'statements',
  false,
  26214400, -- 25MB
  ARRAY['application/pdf', 'application/x-ofx']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
