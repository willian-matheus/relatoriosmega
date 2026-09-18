-- ============================================================================
-- Migration: 20260917000001_create_google_drive_integrations.sql
-- Descrição: Tabela para armazenamento de tokens OAuth do Google Drive
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.google_drive_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'default_user',
  google_email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  folder_id TEXT,
  folder_name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_google_drive_user UNIQUE (user_id)
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_google_drive_user_id ON public.google_drive_integrations (user_id);
CREATE INDEX IF NOT EXISTS idx_google_drive_active ON public.google_drive_integrations (active);

-- Trigger de updated_at
DROP TRIGGER IF EXISTS set_google_drive_updated_at ON public.google_drive_integrations;
CREATE TRIGGER set_google_drive_updated_at
BEFORE UPDATE ON public.google_drive_integrations
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.google_drive_integrations ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso para a integração
DROP POLICY IF EXISTS "Permitir acesso a google_drive_integrations" ON public.google_drive_integrations;
CREATE POLICY "Permitir acesso a google_drive_integrations"
ON public.google_drive_integrations FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);
