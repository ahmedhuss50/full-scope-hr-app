-- 070_dsb_tenant_label_overrides.sql
-- ----------------------------------------------------------------------------
-- Per-tenant display-label overrides for the two fixed enum lists that
-- appear on القوائم والنسب:
--
--   • deposit_category_labels    → renames for buyer_collection / wrong_transfer /
--                                  self_financing / bank_financing / other
--                                  (the DB column values stay the same — only
--                                  what the user sees changes)
--   • disbursement_type_labels   → renames for construction / admin_marketing /
--                                  bank_financing / moh_incentive /
--                                  unit_seriousness_fees / vat_project_registry /
--                                  vat_sales_payment / other
--
-- Both stored as jsonb objects keyed by the enum code. An empty object (or
-- missing key) means "use the default Arabic label from the code". Consumers
-- resolve via lib/dsb/category-labels.ts.
-- ----------------------------------------------------------------------------

alter table tenants
  add column if not exists deposit_category_labels  jsonb not null default '{}'::jsonb,
  add column if not exists disbursement_type_labels jsonb not null default '{}'::jsonb;

comment on column tenants.deposit_category_labels is
  'Per-tenant Arabic label overrides for dsb_payments.deposit_category. Object keyed by the enum code (buyer_collection / wrong_transfer / self_financing / bank_financing / other) with the Arabic display label as value. Missing keys fall back to the code-shipped default.';
comment on column tenants.disbursement_type_labels is
  'Per-tenant Arabic label overrides for dsb_cases.extracted_fields.disbursement_type_code. Object keyed by the enum code with the Arabic display label as value.';
