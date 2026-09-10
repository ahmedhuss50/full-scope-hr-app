-- 073_dsb_vendor_bank_and_iban_ownership.sql
-- ----------------------------------------------------------------------------
-- Two small additions to dsb_vendors surfaced on the Add Vendor form:
--
--   • bank_name                — اسم البنك (free text)
--   • iban_ownership_*         — الشهادة الملكية للـ IBAN
--                                (PDF attachment, same shape as the VAT +
--                                 commercial-registration docs in mig 072)
-- ----------------------------------------------------------------------------

alter table dsb_vendors
  add column if not exists bank_name                              text,
  add column if not exists iban_ownership_storage_path            text,
  add column if not exists iban_ownership_filename                text,
  add column if not exists iban_ownership_size_bytes              bigint;

comment on column dsb_vendors.bank_name is
  'Bank name for the vendor''s IBAN (اسم البنك). Free text; no controlled list yet.';
comment on column dsb_vendors.iban_ownership_storage_path is
  'Storage path (vendor-docs bucket) for the vendor''s شهادة ملكية IBAN — bank-issued document proving the IBAN belongs to the vendor.';
