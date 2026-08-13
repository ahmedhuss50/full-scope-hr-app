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

-- 1) Extend the enum. Postgres requires ALTER TYPE ... ADD VALUE outside a
--    transaction block, so we wrap the check + add in a DO block that runs
--    the ADD only if the value isn't already present.
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

-- 2) Tracking columns. All nullable — only populated when the case reaches
--    the 'rejected' status.
alter table dsb_cases
  add column if not exists rejected_at         timestamptz,
  add column if not exists rejected_by_user_id uuid,
  add column if not exists rejection_reason    text;

-- 3) Partial index for the archive query "rejected cases most recent first".
create index if not exists dsb_cases_rejected_idx
  on dsb_cases (tenant_id, rejected_at desc)
  where status = 'rejected';

notify pgrst, 'reload schema';
