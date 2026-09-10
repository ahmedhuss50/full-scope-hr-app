-- 068_dsb_rega_report_extended_fields.sql
-- ----------------------------------------------------------------------------
-- Extends migration 066 with every remaining field the REGA accountant
-- workbook «نموذج المحاسب القانوني» Sheet 1 «البيانات الأساسية» expects.
--
-- Grouped as they appear on the sheet:
--
--   • Estimated costs — feed the variance analysis on Sheet 5:
--       land_price_sar
--       estimated_construction_sar
--       estimated_admin_marketing_sar
--
--   • Contractors (up to 4) — appear on Sheet 1 rows 13–16:
--       contractor_N_name, contractor_N_contract_sar
--
--   • Project dates:
--       project_start_date         (تاريخ بدء المشروع)
--       rega_license_expiry_date   (تاريخ انتهاء الترخيص)
--
--   • Engineer / consultant:
--       engineer_consultant_name
--       engineer_consultant_contract_sar
--
--   • Tenant-level:
--       accountant_signer_phone    (رقم جوال المُوقِّع)
--
-- All fields nullable so the generator can print blanks for anything
-- still-to-be-filled without failing the request.
-- ----------------------------------------------------------------------------

alter table dsb_projects
  add column if not exists land_price_sar                    numeric,
  add column if not exists estimated_construction_sar        numeric,
  add column if not exists estimated_admin_marketing_sar     numeric,

  add column if not exists project_start_date                date,
  add column if not exists rega_license_expiry_date          date,

  add column if not exists engineer_consultant_name          text,
  add column if not exists engineer_consultant_contract_sar  numeric,

  add column if not exists contractor_1_name                 text,
  add column if not exists contractor_1_contract_sar         numeric,
  add column if not exists contractor_2_name                 text,
  add column if not exists contractor_2_contract_sar         numeric,
  add column if not exists contractor_3_name                 text,
  add column if not exists contractor_3_contract_sar         numeric,
  add column if not exists contractor_4_name                 text,
  add column if not exists contractor_4_contract_sar         numeric;

comment on column dsb_projects.land_price_sar is
  'Purchase price of the project land in SAR. Appears on Sheet 1 (D7) of the REGA accountant workbook and drives the projected-margin calculation.';
comment on column dsb_projects.estimated_construction_sar is
  'Estimated total construction cost (feasibility study figure). Compared to actual construction spend on Sheet 5 (variance analysis).';
comment on column dsb_projects.estimated_admin_marketing_sar is
  'Estimated total admin + marketing cost (feasibility study figure). Compared to actual admin/marketing spend on Sheet 5.';
comment on column dsb_projects.project_start_date is
  'Actual project start date (تاريخ بدء المشروع). Distinct from rega_agreement_date — that''s when we started supervising, this is when construction / sales began.';
comment on column dsb_projects.rega_license_expiry_date is
  'Expiry date of the project''s REGA license (تاريخ انتهاء الترخيص). Used for renewal reminders and to flag expired licenses on the dashboard.';

alter table tenants
  add column if not exists accountant_signer_phone text;

comment on column tenants.accountant_signer_phone is
  'Phone number of the accountant office''s authorized signer (رقم جوال المُوقِّع). Prints on Sheet 1 of every REGA accountant workbook.';
