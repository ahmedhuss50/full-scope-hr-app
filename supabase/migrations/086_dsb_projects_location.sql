-- 086_dsb_projects_location.sql
-- ----------------------------------------------------------------------------
-- Location fields on the project — needed by the CPA quarterly report
-- (Sheet 5 «تحليل البيانات المالية») and by any regional reporting.
--
--   region   — المنطقة (e.g. "الرياض")
--   city     — المدينة
--   district — الحي
--
-- All optional / free text so existing projects remain valid.
-- ----------------------------------------------------------------------------

alter table dsb_projects
  add column if not exists region_ar   text,
  add column if not exists city_ar     text,
  add column if not exists district_ar text;

comment on column dsb_projects.region_ar   is 'المنطقة — administrative region. Prints on Sheet 5 of the CPA quarterly report.';
comment on column dsb_projects.city_ar     is 'المدينة — city. Prints on Sheet 5 of the CPA quarterly report.';
comment on column dsb_projects.district_ar is 'الحي — district / neighborhood. Prints on Sheet 5 of the CPA quarterly report.';

notify pgrst, 'reload schema';
