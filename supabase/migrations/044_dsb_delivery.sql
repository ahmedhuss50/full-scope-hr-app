-- 044_dsb_delivery.sql
-- ----------------------------------------------------------------------------
-- Document delivery + recipient capture + archival.
--
-- After a case is signed, any staff member can mark it delivered to the
-- recipient (الـمستلم). We record who signed off on the handoff (the staff
-- member), the recipient's identity, the delivery time, and any notes.
--
-- The new 'delivered' status acts as the archived state — delivered cases
-- are filtered out of the active inbox by default but stay queryable.
-- ----------------------------------------------------------------------------

-- 1) Extend the status enum. ADD VALUE is idempotent-friendly via DO block.
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'delivered'
      and enumtypid = 'dsb_case_status'::regtype
  ) then
    alter type dsb_case_status add value 'delivered';
  end if;
end$$;

-- 2) New columns on dsb_cases. All nullable; only populated when delivered.
alter table dsb_cases
  add column if not exists delivered_at         timestamptz,
  add column if not exists delivered_by_user_id uuid references public.users(id),
  add column if not exists recipient_name       text,
  add column if not exists recipient_id_number  text,
  add column if not exists recipient_phone      text,
  add column if not exists recipient_notes      text,
  add column if not exists delivery_notes       text;
