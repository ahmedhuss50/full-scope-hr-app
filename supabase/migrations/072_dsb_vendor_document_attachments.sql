-- 072_dsb_vendor_document_attachments.sql
-- ----------------------------------------------------------------------------
-- Per-vendor PDF attachments for the two identity documents that the owner
-- wants filed alongside every vendor:
--
--   • الشهادة الضريبية       → vat_certificate_*
--   • السجل التجاري          → commercial_registration_doc_*
--
-- Same storage-metadata pattern as dsb_vendor_contracts (path / filename /
-- size). Storage bucket is implicit — we use the same one as vendor
-- contracts (dsb-vendor-docs) so all vendor-scoped files sit together.
--
-- The existing `tax_number` and `commercial_registration` text columns stay
-- — those are the numbers, these are the scanned PDFs.
-- ----------------------------------------------------------------------------

alter table dsb_vendors
  add column if not exists vat_certificate_storage_path        text,
  add column if not exists vat_certificate_filename            text,
  add column if not exists vat_certificate_size_bytes          bigint,

  add column if not exists commercial_registration_storage_path text,
  add column if not exists commercial_registration_filename     text,
  add column if not exists commercial_registration_size_bytes   bigint;

comment on column dsb_vendors.vat_certificate_storage_path is
  'Storage path (in the vendor-docs bucket) of the vendor''s VAT-certificate PDF. Uploaded via requestVendorDocUploadUrl → attachVendorDoc.';
comment on column dsb_vendors.commercial_registration_storage_path is
  'Storage path of the vendor''s Commercial Registration PDF. Distinct from the text `commercial_registration` field which stores the CR NUMBER.';
