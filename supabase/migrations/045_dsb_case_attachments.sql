-- 045_dsb_case_attachments.sql
-- ----------------------------------------------------------------------------
-- Supplementary document attachments on a case.
--
-- The existing dsb_uploads table stored only the primary voucher PDF
-- (current + superseded versions). We now also allow attaching supporting
-- documents — receipts, completion certificates, scanned IDs, anything that
-- supplements the voucher but isn't the voucher itself.
--
-- Discriminator: `category` ('primary' | 'supplementary'). Default 'primary'
-- so existing rows behave as before. New attachments use 'supplementary'.
-- `attachment_label` is the user-supplied human description of what the
-- attachment is.
-- ----------------------------------------------------------------------------

alter table dsb_uploads
  add column if not exists category         text default 'primary',
  add column if not exists attachment_label text;

-- Make sure any pre-existing rows are explicitly tagged 'primary' so the
-- new filter (`category = 'primary'`) doesn't accidentally hide them.
update dsb_uploads
  set category = 'primary'
  where category is null;

-- Quick index for the most common query pattern (list a case's attachments).
create index if not exists dsb_uploads_supp_case_idx
  on dsb_uploads (tenant_id, case_id, uploaded_at desc)
  where category = 'supplementary';
