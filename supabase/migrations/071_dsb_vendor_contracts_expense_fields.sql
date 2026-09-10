-- 071_dsb_vendor_contracts_expense_fields.sql
-- ----------------------------------------------------------------------------
-- Adds the three columns the owner wants surfaced when adding a vendor:
--   • disbursement_nature      — طبيعة المصروف (free text; can graduate to
--                                 an enum from القوائم والنسب later).
--   • amount_before_tax_sar    — إجمالي قيمة العقد قبل الضريبة.
--   • vat_sar                  — قيمة الضريبة.
--
-- Existing total_amount_sar stays as the with-tax figure (kept for backward
-- compatibility with rows already inserted). The AddVendorForm's inline
-- contracts table populates all three new columns.
-- ----------------------------------------------------------------------------

alter table dsb_vendor_contracts
  add column if not exists disbursement_nature   text,
  add column if not exists amount_before_tax_sar numeric(14, 2),
  add column if not exists vat_sar               numeric(14, 2);

comment on column dsb_vendor_contracts.disbursement_nature is
  'طبيعة المصروف — describes what the contract''s payments will be booked against (e.g. مقاولات إنشائية, تسويق, استشارات). Free text today; will graduate to a picker from القوائم والنسب once we standardize.';
comment on column dsb_vendor_contracts.amount_before_tax_sar is
  'Contract value BEFORE VAT. total_amount_sar continues to hold the with-tax total.';
comment on column dsb_vendor_contracts.vat_sar is
  'VAT amount on the contract. amount_before_tax_sar + vat_sar should reconcile with total_amount_sar when all three are set.';
