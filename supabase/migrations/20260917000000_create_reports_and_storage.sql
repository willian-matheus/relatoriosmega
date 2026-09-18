-- ============================================================================
-- Migration: 20260917000000_create_reports_and_storage.sql
-- Descrição: Tabelas de Relatórios, Oportunidades, Atividades e Bucket Storage
-- ============================================================================

-- 1. Função utilitária para atualização automática de updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Tabela de Relatórios (reports)
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT,
  file_size BIGINT,
  mime_type TEXT DEFAULT 'text/csv',
  count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices em reports
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports (status);

-- Trigger de updated_at em reports
DROP TRIGGER IF EXISTS set_reports_updated_at ON public.reports;
CREATE TRIGGER set_reports_updated_at
BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Tabela de Oportunidades do CRM (opportunities)
CREATE TABLE IF NOT EXISTS public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  company TEXT NOT NULL,
  contact TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  value NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contact', 'proposal', 'negotiation', 'won')),
  owner TEXT NOT NULL DEFAULT 'Ana Martins',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  source TEXT NOT NULL DEFAULT 'Cadastro manual',
  due_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices em opportunities (FK e consultas principais)
CREATE INDEX IF NOT EXISTS idx_opportunities_report_id ON public.opportunities (report_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON public.opportunities (stage);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON public.opportunities (owner);
CREATE INDEX IF NOT EXISTS idx_opportunities_due_date ON public.opportunities (due_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON public.opportunities (created_at DESC);

-- Trigger de updated_at em opportunities
DROP TRIGGER IF EXISTS set_opportunities_updated_at ON public.opportunities;
CREATE TRIGGER set_opportunities_updated_at
BEFORE UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 4. Tabela de Atividades do CRM (activities)
CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices em activities (FKs e timeline)
CREATE INDEX IF NOT EXISTS idx_activities_report_id ON public.activities (report_id);
CREATE INDEX IF NOT EXISTS idx_activities_opportunity_id ON public.activities (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON public.activities (created_at DESC);

-- 5. Configuração de Row Level Security (RLS)
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso para reports
DROP POLICY IF EXISTS "Permitir acesso completo a reports" ON public.reports;
CREATE POLICY "Permitir acesso completo a reports"
ON public.reports FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Políticas de acesso para opportunities
DROP POLICY IF EXISTS "Permitir acesso completo a opportunities" ON public.opportunities;
CREATE POLICY "Permitir acesso completo a opportunities"
ON public.opportunities FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Políticas de acesso para activities
DROP POLICY IF EXISTS "Permitir acesso completo a activities" ON public.activities;
CREATE POLICY "Permitir acesso completo a activities"
ON public.activities FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 6. Configuração do Bucket de Storage para Relatórios
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reports',
  'reports',
  false,
  52428800, -- 50MB
  ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Políticas de Storage para o bucket 'reports'
DROP POLICY IF EXISTS "Permitir select em reports bucket" ON storage.objects;
CREATE POLICY "Permitir select em reports bucket"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'reports');

DROP POLICY IF EXISTS "Permitir insert em reports bucket" ON storage.objects;
CREATE POLICY "Permitir insert em reports bucket"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'reports');

DROP POLICY IF EXISTS "Permitir update em reports bucket" ON storage.objects;
CREATE POLICY "Permitir update em reports bucket"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'reports');

DROP POLICY IF EXISTS "Permitir delete em reports bucket" ON storage.objects;
CREATE POLICY "Permitir delete em reports bucket"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'reports');
