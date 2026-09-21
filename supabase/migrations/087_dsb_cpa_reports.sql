-- 087_dsb_cpa_reports.sql
-- ----------------------------------------------------------------------------
-- CPA quarterly report record — one row per project per quarter. Holds the
-- inputs the CPA workbook needs that we can't compute automatically:
--
--   • Preparer overrides (per-report; falls back to tenants defaults)
--   • Opening balance carried in from the previous quarter
--   • Forecast rows (العمليات المالية المتوقعة للربع القادم) as JSONB
--   • Free-text narrative sections (Sheet 6):
--       notes_sales, notes_expenses, notes_collection,
--       notes_current_risks, notes_future_risks, notes_other
--
-- Everything else in the workbook is derived at generation time from
-- dsb_projects / dsb_cases / dsb_payments / dsb_project_units / etc.
-- ----------------------------------------------------------------------------

create table if not exists dsb_cpa_reports (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  project_id               uuid not null references dsb_projects(id) on delete cascade,

  period_year              int  not null check (period_year between 2020 and 2100),
  period_quarter           int  not null check (period_quarter between 1 and 4),

  -- Preparer info (falls back to tenants.accountant_signer_* if null)
  preparer_name            text,
  preparer_phone           text,
  preparer_email           text,

  -- Opening balance (رصيد إغلاق الربع السابق)
  opening_balance_sar      numeric(14, 2) not null default 0,

  -- Forecast for next quarter — JSONB array of
  -- { seq, label_ar, side, amount_sar }  where side ∈ ('debit','credit')
  forecast_rows            jsonb,

  -- Sheet 6 narrative
  notes_sales              text,
  notes_expenses           text,
  notes_collection         text,
  notes_current_risks      text,
  notes_future_risks       text,
  notes_other              text,

  -- Generation audit
  generated_at             timestamptz,
  generated_by_user_id     uuid references users(id) on delete set null,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (tenant_id, project_id, period_year, period_quarter)
);

create index if not exists dsb_cpa_reports_project_idx
  on dsb_cpa_reports (tenant_id, project_id, period_year desc, period_quarter desc);

comment on table dsb_cpa_reports is
  'CPA quarterly report — one per project per quarter. Holds the human inputs (preparer, opening balance, forecast, narrative). All computed sheet data is derived from other tables at generation time.';

notify pgrst, 'reload schema';
