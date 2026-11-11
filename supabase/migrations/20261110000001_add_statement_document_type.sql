-- ============================================================================
-- Migration: 20261110000001_add_statement_document_type.sql
-- Descrição: Tipo do documento solicitado no Gestta (ex.: "Extratos de Conta
--            Corrente") e data em que o cliente enviou o arquivo.
-- ============================================================================

ALTER TABLE public.gestta_statement_files
  ADD COLUMN IF NOT EXISTS document_type TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
