-- 060_dsb_case_rejected_status.sql
-- ----------------------------------------------------------------------------
-- Add a formal "rejected" terminal state to the case workflow.
--
-- Distinction from existing states:
--   - sent_back_to_developer → temporary; developer fixes and re-submits
--   - cancelled              → case abandoned entirely (rarely used)
--   - rejected               → NEW: reviewer formally rejects the voucher;
--                              case is archived alongside 'delivered' but
--                              flagged with a distinct red chip and a
--                              rejection_reason for the record
--
-- Also adds tracking columns (who rejected, when, and why) so the archive
-- can render "من رفض هذه الوثيقة ولماذا" without extra lookups.
--
-- Idempotent. Safe on live DB.
-- ----------------------------------------------------------------------------

-- Postgres constraint: a newly-added enum value can't be referenced in the
-- same transaction as the ADD VALUE. Because supabase CLI wraps a migration
-- file in one transaction and the SQL editor runs multi-statement queries
-- in one transaction too, we do the enum ADD in its own COMMIT'd block
-- before the index that uses `where status = 'rejected'`.
--
-- If you're running this in the Supabase SQL editor manually, run in TWO
-- separate queries: everything up to the first `commit;`, then the rest.

-- 1) Extend the enum, in its own transaction.
begin;
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'rejected'
      and enumtypid = 'dsb_case_status'::regtype
  ) then
    alter type dsb_case_status add value 'rejected';
  end if;
end $$;
commit;

-- 2) Tracking columns + partial index (now that 'rejected' is committed).
alter table dsb_cases
  add column if not exists rejected_at         timestamptz,
  add column if not exists rejected_by_user_id uuid,
  add column if not exists rejection_reason    text;

create index if not exists dsb_cases_rejected_idx
  on dsb_cases (tenant_id, rejected_at desc)
  where status = 'rejected';

notify pgrst, 'reload schema';
