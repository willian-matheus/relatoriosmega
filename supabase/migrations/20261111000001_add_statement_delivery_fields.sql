-- ============================================================================
-- Migration: 20261111000001_add_statement_delivery_fields.sql
-- Descrição: Envio dos extratos para a plataforma de destino (CRM-MEGA).
--            O destino não evita duplicidade, então cada arquivo é enviado
--            uma única vez e o resultado fica registrado aqui.
-- ============================================================================

ALTER TABLE public.gestta_statement_files
  -- enviando | enviado | erro | nao_enviar
  ADD COLUMN IF NOT EXISTS delivery_status TEXT
    CHECK (delivery_status IN ('enviando', 'enviado', 'erro', 'nao_enviar')),
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0,
  -- resposta do destino (id do extrato criado, empresa identificada ou o erro)
  ADD COLUMN IF NOT EXISTS delivery_response TEXT,
  ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_statement_files_delivery
ON public.gestta_statement_files (delivery_status);
