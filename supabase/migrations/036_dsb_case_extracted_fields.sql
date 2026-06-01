-- 036_dsb_case_extracted_fields.sql
-- ============================================================================
-- DISBURSEMENTS — store the latest AI extraction blob on each case
-- ============================================================================
-- Phase 3's n8n workflow runs Claude over the combined PDF to (a) segment it
-- into typed page-ranges and (b) extract headline voucher metadata. With this
-- migration we add a JSONB column that always holds the *most recent* AI
-- interpretation of richer fields (developer/beneficiary/IBAN/invoice line
-- items/etc.) — purely informational, never auto-merged onto the case row.
--
-- Why a separate column instead of more typed fields?
--   - The shape evolves as we tune the prompt; JSONB keeps schema changes free.
--   - The case row's typed columns (voucher_number_text, voucher_date, etc.)
--     are the *human source of truth* and must not be silently overwritten.
--   - The extracted blob is shown next to the case for human review.
--
-- Idempotent: uses `add column if not exists`.
-- ============================================================================

alter table dsb_cases
  add column if not exists extracted_fields jsonb;
