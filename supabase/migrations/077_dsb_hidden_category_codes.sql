-- 077_dsb_hidden_category_codes.sql
-- ----------------------------------------------------------------------------
-- Per-tenant lists of DEFAULT category codes that should be hidden from the
-- lists page + pickers. Custom codes are removed by dropping the key from
-- the labels JSONB; default codes cant actually be deleted (baked into the
-- app + DB CHECK constraint) so we track them here instead.
--
--   • deposit_category_hidden   → array of built-in deposit codes to hide
--   • disbursement_type_hidden  → array of built-in disbursement codes to hide
--
-- Owner-only. The category picker on the payments form filters against this.
-- ----------------------------------------------------------------------------

alter table tenants
  add column if not exists deposit_category_hidden  jsonb not null default '[]'::jsonb,
  add column if not exists disbursement_type_hidden jsonb not null default '[]'::jsonb;

comment on column tenants.deposit_category_hidden is
  'JSONB text array of built-in deposit_category codes hidden from القوائم والنسب + pickers. Consumers filter these out at read time. Empty array by default.';
