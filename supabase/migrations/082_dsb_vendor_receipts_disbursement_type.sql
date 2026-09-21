-- 082_dsb_vendor_receipts_disbursement_type.sql
-- ----------------------------------------------------------------------------
-- Attach a نوع الصرف to each vendor receipt so it flows straight into the
-- disbursement case (سند صرف) when the operator clicks «إنشاء سند صرف».
--
-- Uses the same disbursement-type codes as dsb_cases.extracted_fields
-- (construction / admin_marketing / bank_financing / … / custom_*).
-- Text column, no CHECK — the app enforces the code list from
-- lib/dsb/category-labels.ts + tenant overrides.
-- ----------------------------------------------------------------------------

alter table dsb_vendor_receipts
  add column if not exists disbursement_type_code text;

comment on column dsb_vendor_receipts.disbursement_type_code is
  'نوع الصرف — one of the shipped disbursement_type codes or a tenant custom_* code. Copied into dsb_cases.extracted_fields.disbursement_type_code when a case is created from this receipt.';

notify pgrst, 'reload schema';
