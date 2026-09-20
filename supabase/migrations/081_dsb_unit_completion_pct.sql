-- 081_dsb_unit_completion_pct.sql
-- ----------------------------------------------------------------------------
-- Numeric completion percentage (0–100) per unit, surfaced on قائمة الوحدات.
--
-- Ships alongside the existing completion_status enum (74). The two stay in
-- sync via the app: setting pct = 100 auto-flips status → 'completed' (with
-- today as completion_date if empty). Dropping below 100 reverts status.
-- ----------------------------------------------------------------------------

alter table dsb_project_units
  add column if not exists completion_pct int not null default 0;

alter table dsb_project_units
  drop constraint if exists dsb_project_units_completion_pct_chk;
alter table dsb_project_units
  add constraint dsb_project_units_completion_pct_chk
    check (completion_pct between 0 and 100);

-- Backfill: units already marked completed get 100%.
update dsb_project_units
  set completion_pct = 100
  where completion_status = 'completed' and completion_pct = 0;

comment on column dsb_project_units.completion_pct is
  'نسبة الإنجاز — 0..100. Reaching 100 auto-flips completion_status to completed via the app.';

notify pgrst, 'reload schema';
