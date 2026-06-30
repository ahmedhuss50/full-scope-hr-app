-- 052_dsb_checklist_scope.sql
-- ============================================================================
-- SCOPED CHECKLIST ITEMS (per-client / per-project)
-- ============================================================================
-- Before this migration, every active checklist item in `dsb_checklist_items`
-- applied to every case in the tenant (global within the tenant; rows with
-- tenant_id IS NULL are the multi-tenant defaults seeded in 034).
--
-- After this migration, an item can ALSO be scoped to a single client
-- (developer_id) or a single project (project_id). Scope columns are mutually
-- exclusive: at most one may be set per row. Both NULL = same behavior as
-- before (applies to every case in the tenant / globally).
--
-- Case-level visibility (applied in app code) becomes:
--   item visible to a case  <=>  (project_id IS NULL AND developer_id IS NULL)
--                              OR project_id   = case.project_id
--                              OR developer_id = case.developer_id
--
-- Existing data: all current rows have (NULL, NULL) and continue to be global.
-- This migration is purely additive — no destructive changes.
--
-- RUN ORDER: depends on 030 (dsb_projects, dsb_developers) and 034
--            (dsb_checklist_items).
-- ============================================================================

alter table dsb_checklist_items
  add column if not exists project_id   uuid references dsb_projects(id)   on delete cascade,
  add column if not exists developer_id uuid references dsb_developers(id) on delete cascade;

-- Mutex: at most one scope at a time. (NULL, NULL) means global (existing behavior).
alter table dsb_checklist_items
  drop constraint if exists dsb_checklist_items_scope_mutex_chk;
alter table dsb_checklist_items
  add constraint dsb_checklist_items_scope_mutex_chk
  check (project_id is null or developer_id is null);

-- Indexes for the per-case fetch (filter scoped rows by case.project_id /
-- case.developer_id). Partial indexes keep them tight — only scoped rows
-- are indexed; the existing dsb_checklist_items_order_idx already covers
-- the global path.
create index if not exists dsb_checklist_items_project_idx
  on dsb_checklist_items (project_id) where project_id is not null;

create index if not exists dsb_checklist_items_developer_idx
  on dsb_checklist_items (developer_id) where developer_id is not null;
