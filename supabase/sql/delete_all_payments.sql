-- delete_all_payments.sql
-- ============================================================================
-- One-shot cleanup: snapshot then DELETE every row from dsb_payments.
-- Intended to be run once by the owner in the Supabase SQL editor after the
-- VAT-convention flip (commit 60f1f75) — all historical payments were stored
-- as with-VAT, so wiping and re-importing under the new pre-VAT convention is
-- cleaner than a lossy ÷1.05 backfill.
--
-- Scope: EVERY tenant, EVERY project — the user explicitly asked for this.
-- Related rows (dsb_cases.id references don't live on payments, so no FK
-- cascade issues — payments only point OUT to sales/accounts, nothing points IN).
--
-- Safety:
--   • Snapshots the entire table into dsb_payments_backup_pre_delete first
--     with a timestamp, so you can restore wholesale via INSERT ... SELECT.
--   • Wrapped in a transaction. Review the row counts BEFORE committing.
--     If anything looks wrong, type ROLLBACK instead of COMMIT.
--
-- To restore:
--   INSERT INTO dsb_payments SELECT * FROM dsb_payments_backup_pre_delete;
--   -- (drop the backup once you're sure you don't need it)
-- ============================================================================

begin;

-- 1. Snapshot — full row copy including all columns via SELECT *.
--    Named with a date suffix so repeated runs don't clobber each other.
drop table if exists dsb_payments_backup_pre_delete;
create table dsb_payments_backup_pre_delete as
  table dsb_payments;

-- Record the backup timestamp so you can tell when the snapshot was taken.
alter table dsb_payments_backup_pre_delete
  add column if not exists backed_up_at timestamptz default now();

-- 2. Preview counts BEFORE deleting. If these look wrong, type ROLLBACK.
select
  (select count(*) from dsb_payments)                 as payments_now,
  (select count(*) from dsb_payments_backup_pre_delete) as snapshot_rows;

-- 3. Delete everything.
delete from dsb_payments;

-- 4. Confirm the delete.
select
  (select count(*) from dsb_payments)                 as payments_after_delete,
  (select count(*) from dsb_payments_backup_pre_delete) as snapshot_rows_kept;

-- 5. If both preview counts matched and the after-delete is 0, commit.
--    Otherwise type:  rollback;
commit;
