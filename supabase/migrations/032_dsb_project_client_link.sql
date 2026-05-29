-- 032_dsb_project_client_link.sql
-- ============================================================================
-- DISBURSEMENTS — link each project to a single client (developer)
-- ============================================================================
-- Each `dsb_projects` row now optionally points at one `dsb_developers` row.
-- Nullable for backwards compatibility (legacy projects stay untied and remain
-- selectable as a fallback in the case form until they are migrated).
--
-- RUN ORDER: depends on 030_dsb_schema, 031_dsb_seed.
-- ============================================================================

-- Each project belongs to one client (developer).
alter table dsb_projects
  add column if not exists developer_id uuid references dsb_developers(id) on delete set null;

create index if not exists dsb_projects_developer_idx on dsb_projects (developer_id);

-- Backfill the seeded project to the seeded developer (idempotent — safe to re-run).
update dsb_projects
   set developer_id = 'dddd0001-0000-0000-0000-000000000001'
 where id = 'dddd0002-0000-0000-0000-000000000001'
   and developer_id is null;
