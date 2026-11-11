-- ============================================================================
-- Migration: 20261111000002_add_statement_fingerprint.sql
-- Descrição: "Impressão digital" de cada extrato (conta e lançamentos), usada na
--            deduplicação do envio. Calculada uma vez e reaproveitada, para o envio
--            não precisar baixar e reler cada arquivo a cada execução.
--            Formato: { "v": 1, "account": {bankCode, number} | null,
--                       "transactions": [["AAAA-MM-DD", centavos], ...] | null }
-- ============================================================================

ALTER TABLE public.gestta_statement_files
  ADD COLUMN IF NOT EXISTS fingerprint JSONB;
