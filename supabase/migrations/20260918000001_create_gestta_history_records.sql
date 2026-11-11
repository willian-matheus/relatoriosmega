-- ============================================================================
-- Migration: 20260918000001_create_gestta_history_records.sql
-- Descrição: Histórico das tarefas do Gestta sincronizadas (usado pela aba Histórico).
--            A tabela era usada pelo código e alterada em 20260919000000, mas não
--            tinha migração de criação. Idempotente: não altera uma tabela existente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gestta_history_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gestta_task_id TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  company_code TEXT,
  company_cnpj TEXT,
  competence TEXT,
  task_name TEXT NOT NULL,
  status TEXT,
  due_date DATE,
  legal_date DATE,
  department TEXT,
  overdue BOOLEAN NOT NULL DEFAULT false,
  drive_folder_id TEXT,
  drive_file_id TEXT,
  drive_file_link TEXT,
  drive_json_link TEXT,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gestta_history_company ON public.gestta_history_records (company_name);
CREATE INDEX IF NOT EXISTS idx_gestta_history_competence ON public.gestta_history_records (competence);
CREATE INDEX IF NOT EXISTS idx_gestta_history_report_id ON public.gestta_history_records (report_id);

DROP TRIGGER IF EXISTS set_gestta_history_updated_at ON public.gestta_history_records;
CREATE TRIGGER set_gestta_history_updated_at
BEFORE UPDATE ON public.gestta_history_records
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Acesso somente pela chave de serviço (sem políticas para anon/authenticated)
ALTER TABLE public.gestta_history_records ENABLE ROW LEVEL SECURITY;
