-- ============================================================================
-- Migration: 20260918000000_create_gestta_integrations.sql
-- Descrição: Tabela para integração com a plataforma contábil Gestta
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gestta_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'default_user',
  email TEXT NOT NULL,
  user_name TEXT,
  company_name TEXT,
  company_cnpj TEXT,
  auth_token TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  total_customers INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_gestta_user UNIQUE (user_id)
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_gestta_user_id ON public.gestta_integrations (user_id);
CREATE INDEX IF NOT EXISTS idx_gestta_active ON public.gestta_integrations (active);

-- Trigger de updated_at
DROP TRIGGER IF EXISTS set_gestta_updated_at ON public.gestta_integrations;
CREATE TRIGGER set_gestta_updated_at
BEFORE UPDATE ON public.gestta_integrations
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.gestta_integrations ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso para a integração
DROP POLICY IF EXISTS "Permitir acesso a gestta_integrations" ON public.gestta_integrations;
CREATE POLICY "Permitir acesso a gestta_integrations"
ON public.gestta_integrations FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);
