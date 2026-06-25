-- 049_dsb_project_employees.sql
-- ----------------------------------------------------------------------------
-- Junction: many-to-many between dsb_projects and users (staff).
--
-- Before this migration, dsb_projects.assigned_employee_id was a single FK
-- pointing at one user. This was too restrictive — in practice a project
-- can have multiple staff reviewing it (a primary مراجع, a backup, a
-- supervisor who watches the queue, a deliverer, etc.), and one person can
-- carry many projects across clients.
--
-- The legacy `assigned_employee_id` column STAYS for now as a "primary"
-- pointer (so old code paths still resolve a sensible single user). The
-- application layer:
--   * writes BOTH places (junction + legacy column) on assignment
--   * reads the JUNCTION for access-control and notification fan-out
--   * falls back to the legacy column when the junction is empty (so
--     unmigrated projects keep working without a manual data fix)
--
-- Owners (مدير) see everything regardless of assignment, so we do not
-- create junction rows for owner-role users.
-- ----------------------------------------------------------------------------

create table if not exists dsb_project_employees (
  project_id        uuid not null references dsb_projects(id) on delete cascade,
  user_id           uuid not null references users(id) on delete cascade,
  tenant_id         uuid not null,
  added_at          timestamptz not null default now(),
  added_by_user_id  uuid,
  primary key (project_id, user_id)
);

-- Look-ups go two ways: "what projects is this user on" and "who is on
-- this project". Index both. Tenant_id is included so the planner can
-- short-circuit per-tenant queries without joining back to dsb_projects.
create index if not exists dsb_project_employees_user_idx
  on dsb_project_employees (user_id, tenant_id);
create index if not exists dsb_project_employees_project_idx
  on dsb_project_employees (project_id, tenant_id);

-- Backfill: every existing assigned_employee_id becomes a junction row.
-- on conflict do nothing makes this safe to re-run.
insert into dsb_project_employees (project_id, user_id, tenant_id)
select p.id, p.assigned_employee_id, p.tenant_id
from dsb_projects p
where p.assigned_employee_id is not null
on conflict do nothing;
