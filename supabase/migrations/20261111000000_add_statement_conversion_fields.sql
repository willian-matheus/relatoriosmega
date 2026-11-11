-- ============================================================================
-- Migration: 20261111000000_add_statement_conversion_fields.sql
-- Descrição: OFX gerado a partir de PDF quando o cliente envia somente o PDF
--            do extrato de conta corrente.
-- ============================================================================

ALTER TABLE public.gestta_statement_files
  ADD COLUMN IF NOT EXISTS converted_from_id UUID
    REFERENCES public.gestta_statement_files(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS conversion_note TEXT;

CREATE INDEX IF NOT EXISTS idx_statement_files_converted_from
ON public.gestta_statement_files (converted_from_id)
WHERE converted_from_id IS NOT NULL;
