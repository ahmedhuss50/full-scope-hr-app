-- 043_dsb_delivery_doc_signature.sql
-- ----------------------------------------------------------------------------
-- Signature for وثيقة التسليم (delivery certificate).
--
-- The case's PDF signature (signed_document_path) is separate from this.
-- The delivery doc is an HTML-rendered certificate the owner can sign once
-- the case is finalized; the signature image is stored on Storage and
-- referenced by delivery_doc_signature_path.
-- ----------------------------------------------------------------------------

alter table dsb_cases
  add column if not exists delivery_doc_signature_path    text,
  add column if not exists delivery_doc_signed_at         timestamptz,
  add column if not exists delivery_doc_signed_by_user_id uuid references public.users(id);
