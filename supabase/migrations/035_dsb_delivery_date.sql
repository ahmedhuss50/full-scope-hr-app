-- 035_dsb_delivery_date.sql
-- ============================================================================
-- DISBURSEMENTS — add delivery_date to dsb_cases
-- ============================================================================
-- A simple optional date field captured at case-creation time across all three
-- create paths (developer-portal, staff-on-behalf, tokenised public link).
-- Shown in the case detail facts grid and on the printable delivery document
-- generated once the case is signed.
--
-- Idempotent: uses `add column if not exists`.
-- ============================================================================

alter table dsb_cases
  add column if not exists delivery_date date;
