-- 037_dsb_signed_document.sql
-- ----------------------------------------------------------------------------
-- Manual sign-with-uploaded-document support.
--
-- The owner can sign a case digitally (existing flow, signCase) OR by uploading
-- a physically-signed scanned PDF (new flow, signCaseWithUploadedDocument).
-- Either path sets status='signed' + signed_at + signed_by_user_id; the manual
-- path additionally stores a reference to the uploaded PDF so it can be viewed
-- and downloaded later.
--
-- Both columns are nullable — digitally-signed cases simply leave them null.
-- The PDF lives in the same Storage bucket as the developer's original upload
-- ('Document submission'), under the path:
--     signed/<tenant_id>/<case_id>/<filename>
-- ----------------------------------------------------------------------------

alter table dsb_cases
  add column if not exists signed_document_path text,
  add column if not exists signed_document_filename text;
