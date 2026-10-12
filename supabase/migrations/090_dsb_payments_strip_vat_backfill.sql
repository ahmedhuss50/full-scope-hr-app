-- 090_dsb_payments_strip_vat_backfill.sql — ABANDONED (do not run)
-- ============================================================================
-- Original plan: divide every dsb_payments.amount_sar by 1.05 to convert from
-- the old with-VAT convention to the new pre-VAT convention.
--
-- Superseded by the user's decision to delete all payments and re-upload
-- fresh under the pre-VAT convention (see /supabase/sql/delete_all_payments.sql
-- for the one-shot DELETE script — kept outside /migrations/ on purpose so it
-- isn't picked up by `supabase db push`).
--
-- Left in place as an empty no-op so the numbering stays contiguous and the
-- marker table scheme is preserved for later migrations.
-- ============================================================================

select 1 where false;  -- no-op
