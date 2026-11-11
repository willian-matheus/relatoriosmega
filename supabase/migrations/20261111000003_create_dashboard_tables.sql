-- ============================================================================
-- Migration: 20261111000003_create_dashboard_tables.sql
-- Descrição: Base do Painel de pendências.
--   1. gestta_tasks: retrato das tarefas do Gestta na janela de vencimento,
--      gravado ao fim de cada varredura da captura de extratos.
--   2. gestta_document_requests: itens das solicitações de documentos das
--      tarefas "Envio de Extratos Bancários..." (o que foi pedido x recebido).
--
-- Datas: due_date/task_due_date e competence são calculadas no fuso
-- America/Sao_Paulo pela aplicação (o Gestta grava o fim do dia local em UTC).
--
-- Segurança: RLS habilitado SEM políticas para anon/authenticated.
-- Somente a chave de serviço (SUPABASE_SERVICE_ROLE_KEY) acessa esses dados.
-- ============================================================================

-- 1. Retrato das tarefas
CREATE TABLE IF NOT EXISTS public.gestta_tasks (
  gestta_task_id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  status TEXT,                               -- OPEN | DONE | DISCONSIDERED
  overdue BOOLEAN NOT NULL DEFAULT false,
  done_overdue BOOLEAN NOT NULL DEFAULT false,
  due_date DATE,                             -- vencimento (dia em Brasília)
  competence TEXT,                           -- AAAA-MM (Brasília)
  conclusion_date TIMESTAMPTZ,
  created_at_gestta TIMESTAMPTZ,
  company_gestta_id TEXT,
  company_code TEXT,
  company_name TEXT,
  owner_id TEXT,
  owner_name TEXT,
  steps_total INTEGER,
  steps_done INTEGER,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- início da varredura que gravou a linha
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gestta_tasks_competence ON public.gestta_tasks (competence);
CREATE INDEX IF NOT EXISTS idx_gestta_tasks_status ON public.gestta_tasks (status);
CREATE INDEX IF NOT EXISTS idx_gestta_tasks_company_code ON public.gestta_tasks (company_code);
CREATE INDEX IF NOT EXISTS idx_gestta_tasks_owner_name ON public.gestta_tasks (owner_name);
CREATE INDEX IF NOT EXISTS idx_gestta_tasks_due_date ON public.gestta_tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_gestta_tasks_synced_at ON public.gestta_tasks (synced_at DESC);

DROP TRIGGER IF EXISTS set_gestta_tasks_updated_at ON public.gestta_tasks;
CREATE TRIGGER set_gestta_tasks_updated_at
BEFORE UPDATE ON public.gestta_tasks
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.gestta_tasks ENABLE ROW LEVEL SECURITY;

-- 2. Itens de solicitação de documentos das tarefas de extratos
CREATE TABLE IF NOT EXISTS public.gestta_document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gestta_task_id TEXT NOT NULL,
  requested_document_id TEXT NOT NULL,
  task_name TEXT,
  company_gestta_id TEXT,
  company_code TEXT,
  company_name TEXT,
  competence TEXT,                           -- AAAA-MM (Brasília)
  document_name TEXT,
  is_statement BOOLEAN NOT NULL DEFAULT false, -- item começa com "Extrato"
  files_count INTEGER NOT NULL DEFAULT 0,
  disconsidered BOOLEAN NOT NULL DEFAULT false,
  last_upload_at TIMESTAMPTZ,
  task_status TEXT,
  task_due_date DATE,                        -- vencimento da tarefa (dia em Brasília)
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gestta_document_requests_task_doc_key UNIQUE (gestta_task_id, requested_document_id)
);

CREATE INDEX IF NOT EXISTS idx_document_requests_competence ON public.gestta_document_requests (competence);
CREATE INDEX IF NOT EXISTS idx_document_requests_company_code ON public.gestta_document_requests (company_code);
CREATE INDEX IF NOT EXISTS idx_document_requests_task_due_date ON public.gestta_document_requests (task_due_date);
CREATE INDEX IF NOT EXISTS idx_document_requests_pending
ON public.gestta_document_requests (competence, company_code)
WHERE is_statement AND NOT disconsidered AND files_count = 0;

DROP TRIGGER IF EXISTS set_document_requests_updated_at ON public.gestta_document_requests;
CREATE TRIGGER set_document_requests_updated_at
BEFORE UPDATE ON public.gestta_document_requests
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.gestta_document_requests ENABLE ROW LEVEL SECURITY;
