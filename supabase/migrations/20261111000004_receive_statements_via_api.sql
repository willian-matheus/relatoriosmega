-- ============================================================================
-- Migration: 20261111000004_receive_statements_via_api.sql
-- Descrição: Recebimento de extratos enviados por outras plataformas pela API
--            (token com permissão "extratos:write"), em OFX, PDF ou OFC.
--            Os recebidos seguem o mesmo caminho dos extratos do Gestta
--            (armazenamento, cópia no Drive, Painel, API e envio ao CRM-MEGA).
-- ============================================================================

-- Origem do extrato: capturado do Gestta ou recebido pela API
ALTER TABLE public.gestta_statement_files
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'gestta',
  -- token que enviou o arquivo (recebidos pela API)
  ADD COLUMN IF NOT EXISTS received_by_token_id UUID REFERENCES public.api_tokens(id) ON DELETE SET NULL,
  -- dados informados pelo remetente (banco, agência, conta, observação...)
  ADD COLUMN IF NOT EXISTS received_metadata JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gestta_statement_files_source_check'
  ) THEN
    ALTER TABLE public.gestta_statement_files
      ADD CONSTRAINT gestta_statement_files_source_check CHECK (source IN ('gestta', 'api'));
  END IF;
END $$;

-- Recebidos pela API não têm tarefa do Gestta
ALTER TABLE public.gestta_statement_files ALTER COLUMN gestta_task_id DROP NOT NULL;

-- Formato OFC passa a ser aceito (guardado como chegou e convertido para OFX)
ALTER TABLE public.gestta_statement_files DROP CONSTRAINT IF EXISTS gestta_statement_files_format_check;
ALTER TABLE public.gestta_statement_files
  ADD CONSTRAINT gestta_statement_files_format_check CHECK (format IN ('ofx', 'pdf', 'ofc'));

CREATE INDEX IF NOT EXISTS idx_statement_files_source ON public.gestta_statement_files (source);

-- Bucket aceita o tipo do OFC
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['application/pdf', 'application/x-ofx', 'application/x-ofc']
 WHERE id = 'statements';
