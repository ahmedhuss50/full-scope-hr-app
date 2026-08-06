-- 059_dsb_cases_per_project_numbering.sql
-- ----------------------------------------------------------------------------
-- Rework case identification to be per-project instead of tenant-wide.
--
-- Product change: each project owns its own counter. Project X starts at 1
-- and increments; Project Y starts at 1 and increments. The same case_number
-- string (e.g. "1") can appear once per project without conflict.
--
-- Voucher-number duplicates within a project are now blocked at the DB
-- level — the second import of a voucher with the same voucher_number_text
-- in the same project fails cleanly. Legacy vouchers without a text number
-- are unaffected (partial index only covers non-null values).
--
-- Existing case_number values ("DSB-0001", "DSB-0187", …) stay in place.
-- The old numbering scheme is treated as legacy — new uploads use plain
-- integer counters ("1", "2", …) computed per project.
--
-- Idempotent. Safe on a live DB after Step 1/2 of the dedup script has run
-- (which is why this migration should be applied AFTER the rename SQL that
-- disambiguated duplicate voucher_number_text values).
-- ----------------------------------------------------------------------------

-- 1) Drop the tenant-wide unique constraint on case_number. Per-project
--    counters mean the same "1" appears in every project and that must be
--    allowed. The old constraint is auto-named by Postgres from the CREATE
--    TABLE UNIQUE clause; we drop by both possible names to be safe.
alter table dsb_cases
  drop constraint if exists dsb_cases_tenant_id_case_number_key;
alter table dsb_cases
  drop constraint if exists dsb_cases_tenant_case_number_unique;

-- 2) Per-project uniqueness on case_number — the new identity rule.
create unique index if not exists dsb_cases_project_case_number_uidx
  on dsb_cases (project_id, case_number);

-- 3) Per-project uniqueness on voucher_number_text (partial: only enforced
--    when a voucher number is actually set). Prevents accidentally uploading
--    the same voucher twice inside one project. Legacy cases with a NULL or
--    empty voucher_number_text are ignored by the index.
create unique index if not exists dsb_cases_project_voucher_uidx
  on dsb_cases (project_id, voucher_number_text)
  where voucher_number_text is not null and voucher_number_text <> '';

-- 4) Refresh PostgREST so clients see the new constraint behavior right
--    away (relevant for error codes the UI surfaces).
notify pgrst, 'reload schema';
