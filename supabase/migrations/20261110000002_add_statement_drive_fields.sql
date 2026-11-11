-- ============================================================================
-- Migration: 20261110000002_add_statement_drive_fields.sql
-- Descrição: Cópia de cada extrato no Google Drive (id e link do arquivo).
-- ============================================================================

ALTER TABLE public.gestta_statement_files
  ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_file_link TEXT;

-- Extratos ainda sem cópia no Drive (reenviados quando o Drive estiver conectado)
CREATE INDEX IF NOT EXISTS idx_statement_files_without_drive
ON public.gestta_statement_files (id)
WHERE drive_file_id IS NULL;
