-- ============================================================================
-- Migration: 20260919000000_add_gestta_history_pdf_fields.sql
-- Descrição: Adiciona colunas para links de relatórios PDF na tabela de histórico
-- ============================================================================

ALTER TABLE public.gestta_history_records 
ADD COLUMN IF NOT EXISTS drive_pdf_link TEXT,
ADD COLUMN IF NOT EXISTS drive_pdf_id TEXT;

-- Índice para consultas por drive_pdf_link
CREATE INDEX IF NOT EXISTS idx_gestta_history_pdf_link 
ON public.gestta_history_records (drive_pdf_link) 
WHERE drive_pdf_link IS NOT NULL;
