-- 074_dsb_unit_completion_and_attachments.sql
-- ----------------------------------------------------------------------------
-- Per-unit completion tracking + delivery/completion PDF attachments,
-- surfaced on قائمة الوحدات:
--
--   • completion_status                — 'not_completed' | 'completed'
--   • completion_date                  — date the unit was declared منجزة
--   • completion_attachment_*          — PDF proof of completion
--   • delivery_attachment_*            — PDF proof of handover
--
-- Delivery status/date already live on dsb_unit_sales (per-sale, since a
-- resold unit gets a new delivery). The delivery ATTACHMENT is kept on the
-- unit because the operator uploads the شهادة تسليم once and only the
-- current-active sale matters for it.
-- ----------------------------------------------------------------------------

alter table dsb_project_units
  add column if not exists completion_status                text not null default 'not_completed',
  add column if not exists completion_date                  date,

  add column if not exists completion_attachment_storage_path text,
  add column if not exists completion_attachment_filename     text,
  add column if not exists completion_attachment_size_bytes   bigint,

  add column if not exists delivery_attachment_storage_path   text,
  add column if not exists delivery_attachment_filename       text,
  add column if not exists delivery_attachment_size_bytes     bigint;

-- Guard against typos in the enum.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dsb_project_units_completion_status_chk'
  ) then
    alter table dsb_project_units
      add constraint dsb_project_units_completion_status_chk
      check (completion_status in ('not_completed', 'completed'));
  end if;
end $$;

comment on column dsb_project_units.completion_status is
  'حالة الإنجاز — منجزة أو غير منجزة. Independent from delivery which lives on the sale.';
comment on column dsb_project_units.completion_date is
  'تاريخ الإنجاز — the date the developer/consultant marked the unit as complete.';
comment on column dsb_project_units.completion_attachment_storage_path is
  'Storage path for the completion certificate PDF (شهادة الإنجاز).';
comment on column dsb_project_units.delivery_attachment_storage_path is
  'Storage path for the delivery/handover PDF (شهادة التسليم). Uploaded once per unit; the current active sale is the beneficiary.';
