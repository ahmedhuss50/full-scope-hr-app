-- 039_dsb_developer_bank.sql
-- ----------------------------------------------------------------------------
-- Track the payer-side banking details on the developer (client) record.
--
-- The disbursement flow has two sides:
--   - Payer:        the developer (project owner). We tag their bank ONCE here
--                   because most developers keep one banking partner.
--   - Beneficiary:  the supplier/vendor receiving funds. This is captured per
--                   voucher by the AI extraction into dsb_cases.extracted_fields.
--
-- All three fields are nullable — we can set them only when we know.
-- ----------------------------------------------------------------------------

alter table dsb_developers
  add column if not exists bank_name      text,
  add column if not exists bank_account   text,
  add column if not exists bank_iban      text;
