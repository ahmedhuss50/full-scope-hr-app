-- 085_dsb_cases_is_downpayment.sql
-- ----------------------------------------------------------------------------
-- Flag a disbursement voucher as a "developer downpayment" payment.
--
-- When TRUE, this voucher is the developer paying (part of) the promised
-- downpayment out of a specific escrow account. Combined with vendor_id
-- (mig 084), the vendor detail page shows it under a dedicated «دفعات
-- مقدمة» section rather than lumping it with regular invoice payments.
-- ----------------------------------------------------------------------------

alter table dsb_cases
  add column if not exists is_downpayment boolean not null default false;

comment on column dsb_cases.is_downpayment is
  'TRUE when this voucher represents payment of (part of) the developer''s downpayment to the vendor. Grouped separately on the vendor detail page.';

notify pgrst, 'reload schema';
