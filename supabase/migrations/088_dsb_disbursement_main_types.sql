-- 088_dsb_disbursement_main_types.sql
-- ----------------------------------------------------------------------------
-- Two-tier hierarchy for أنواع الصرف: main (رئيسية) → sub (فرعية).
--
-- The current list on tenants.disbursement_type_labels stays as-is (those are
-- the sub-types). This migration adds:
--
--   • tenants.disbursement_main_types           JSONB { code: label_ar }
--       Owner-editable main-type list. Seeded with 5 REGA-standard defaults
--       matching Sheet 3 debit rows:
--         main_construction     تكاليف انشائية
--         main_admin_marketing  مصاريف ادارية وتسويقية
--         main_customer_refund  ايداعات عملاء مستردة
--         main_bank_fees        عمولات بنكية
--         main_other            أخرى
--       Owner can rename, add custom_main_*, or delete (defaults get hidden
--       via disbursement_main_types_hidden array).
--
--   • tenants.disbursement_main_types_hidden    JSONB text[]
--       Built-in main-type codes hidden from lists page + pickers. Custom
--       codes are removed by dropping the key from the labels JSONB (default
--       codes are baked into the seed here).
--
--   • tenants.disbursement_type_main            JSONB { sub_code: main_code }
--       Assignment map — each sub-type points at ONE main-type code. Seeded
--       with sensible defaults for the shipped sub-types. Custom sub-types
--       default to main_other until owner reassigns.
--
-- Reads: the CPA report generator resolves sub_code → main_code → main_label
-- when filling Sheet 2 «البند» and Sheet 3 debit buckets, so custom sub-types
-- roll up to whichever main the owner picked.
-- ----------------------------------------------------------------------------

alter table tenants
  add column if not exists disbursement_main_types jsonb not null default '{
    "main_construction":    "تكاليف انشائية",
    "main_admin_marketing": "مصاريف ادارية وتسويقية",
    "main_customer_refund": "ايداعات عملاء مستردة",
    "main_bank_fees":       "عمولات بنكية",
    "main_other":           "أخرى"
  }'::jsonb;

alter table tenants
  add column if not exists disbursement_main_types_hidden jsonb not null default '[]'::jsonb;

alter table tenants
  add column if not exists disbursement_type_main jsonb not null default '{
    "construction":          "main_construction",
    "admin_marketing":       "main_admin_marketing",
    "bank_financing":        "main_other",
    "moh_incentive":         "main_other",
    "unit_seriousness_fees": "main_other",
    "vat_project_registry":  "main_other",
    "vat_sales_payment":     "main_other",
    "customer_refund":       "main_customer_refund",
    "bank_fees":             "main_bank_fees",
    "other":                 "main_other"
  }'::jsonb;

comment on column tenants.disbursement_main_types is
  'Owner-editable map of main-type code → Arabic label. 5 REGA-standard defaults seeded; owner can rename, add custom_main_*, or hide defaults via disbursement_main_types_hidden.';

comment on column tenants.disbursement_main_types_hidden is
  'JSONB text array of built-in main-type codes hidden from القوائم والنسب + pickers. Consumers filter these out at read time.';

comment on column tenants.disbursement_type_main is
  'Assignment map: sub-type code (from disbursement_type_labels) → main-type code (from disbursement_main_types). Drives the البند column on Sheet 2 + debit buckets on Sheet 3 of the CPA report. Any sub-type without a mapping falls back to main_other.';

-- Existing tenants: backfill NULL/empty JSONB values with defaults above.
-- (add column ... default only applies to new rows; existing rows may have
-- had these columns previously as NULL if the migration was ever re-run.)
update tenants
   set disbursement_main_types = '{
     "main_construction":    "تكاليف انشائية",
     "main_admin_marketing": "مصاريف ادارية وتسويقية",
     "main_customer_refund": "ايداعات عملاء مستردة",
     "main_bank_fees":       "عمولات بنكية",
     "main_other":           "أخرى"
   }'::jsonb
 where disbursement_main_types is null
    or disbursement_main_types = '{}'::jsonb;

update tenants
   set disbursement_type_main = '{
     "construction":          "main_construction",
     "admin_marketing":       "main_admin_marketing",
     "bank_financing":        "main_other",
     "moh_incentive":         "main_other",
     "unit_seriousness_fees": "main_other",
     "vat_project_registry":  "main_other",
     "vat_sales_payment":     "main_other",
     "customer_refund":       "main_customer_refund",
     "bank_fees":             "main_bank_fees",
     "other":                 "main_other"
   }'::jsonb
 where disbursement_type_main is null
    or disbursement_type_main = '{}'::jsonb;

notify pgrst, 'reload schema';
