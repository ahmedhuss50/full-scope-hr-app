-- 053_dsb_checklist_templates.sql
-- ============================================================================
-- NAMED CHECKLIST TEMPLATES — supersedes 052
-- ============================================================================
-- Before this migration, checklist items were either global (tenant_id NULL),
-- tenant-wide, or scoped per-item to a project/developer (added in 052).
-- That made it awkward to maintain a wholly separate checklist for a given
-- client or project — every item needed its own scope marker.
--
-- After this migration, items belong to a NAMED TEMPLATE. Each tenant has
-- many templates; one is flagged as the default. Each project and each client
-- may optionally pick a template (`checklist_template_id`). The "effective"
-- template for a case is resolved at fetch time:
--   project.checklist_template_id  →  developer.checklist_template_id
--                                  →  tenant's default template
--                                  →  null (case sees an empty checklist)
--
-- The per-item scope columns added in 052 (project_id / developer_id) are
-- dropped at the end — their data is migrated into templates by the backfill
-- blocks below.
--
-- RUN ORDER: depends on 030 (dsb_projects, dsb_developers), 034
--            (dsb_checklist_items) and 052 (the scope columns we drop).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Templates table
-- ----------------------------------------------------------------------------

create table if not exists dsb_checklist_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists dsb_checklist_templates_tenant_idx
  on dsb_checklist_templates (tenant_id);

-- At most one default per tenant (partial unique index — can't be expressed
-- as a normal table constraint).
create unique index if not exists dsb_checklist_templates_one_default_uq
  on dsb_checklist_templates (tenant_id) where is_default = true;

alter table dsb_checklist_templates enable row level security;

drop policy if exists dsb_chk_tpl_sel on dsb_checklist_templates;
create policy dsb_chk_tpl_sel on dsb_checklist_templates
  for select using (tenant_id = auth_tenant_id());

drop policy if exists dsb_chk_tpl_mod on dsb_checklist_templates;
create policy dsb_chk_tpl_mod on dsb_checklist_templates
  for all
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

-- ----------------------------------------------------------------------------
-- 2. Items belong to a template (nullable until backfill finishes)
-- ----------------------------------------------------------------------------

alter table dsb_checklist_items
  add column if not exists template_id uuid references dsb_checklist_templates(id) on delete cascade;

create index if not exists dsb_checklist_items_template_idx
  on dsb_checklist_items (template_id);

-- ----------------------------------------------------------------------------
-- 3. Projects + clients can opt into a specific template
-- ----------------------------------------------------------------------------

alter table dsb_projects
  add column if not exists checklist_template_id uuid references dsb_checklist_templates(id) on delete set null;

alter table dsb_developers
  add column if not exists checklist_template_id uuid references dsb_checklist_templates(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 4. Backfill — defaults first
-- ----------------------------------------------------------------------------
--
-- For every tenant with existing checklist items, create one default template
-- "افتراضي" (or reuse if a default already exists) and assign every UNSCOPED
-- item to it. Scoped items (project_id / developer_id set) are handled in
-- step 5 so they end up in their own templates, not the global default.

do $$
declare
  t_id   uuid;
  def_id uuid;
begin
  for t_id in (select distinct tenant_id from dsb_checklist_items where tenant_id is not null) loop
    select id into def_id from dsb_checklist_templates
      where tenant_id = t_id and is_default = true limit 1;
    if def_id is null then
      insert into dsb_checklist_templates (tenant_id, name, is_default)
        values (t_id, 'افتراضي', true)
        returning id into def_id;
    end if;
    update dsb_checklist_items
      set template_id = def_id
      where tenant_id = t_id
        and template_id is null
        and project_id is null
        and developer_id is null;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Backfill — per-project and per-client scoped items
-- ----------------------------------------------------------------------------
--
-- For each item that was previously scoped to a specific project, create (or
-- reuse) a template named after the project, point the project at it, and
-- move the item into it. Same for client-scoped items.

do $$
declare
  rec        record;
  new_tpl_id uuid;
begin
  -- Project-scoped items.
  for rec in (
    select ci.id as item_id, ci.tenant_id, ci.project_id, p.name_ar as project_name
      from dsb_checklist_items ci
      join dsb_projects p on p.id = ci.project_id
     where ci.project_id is not null
       and ci.template_id is null
  ) loop
    select checklist_template_id into new_tpl_id from dsb_projects where id = rec.project_id;
    if new_tpl_id is null then
      insert into dsb_checklist_templates (tenant_id, name, is_default)
        values (rec.tenant_id, format('قائمة مشروع %s', rec.project_name), false)
        returning id into new_tpl_id;
      update dsb_projects set checklist_template_id = new_tpl_id where id = rec.project_id;
    end if;
    update dsb_checklist_items set template_id = new_tpl_id where id = rec.item_id;
  end loop;

  -- Client-scoped items.
  for rec in (
    select ci.id as item_id, ci.tenant_id, ci.developer_id, d.company_name_ar as developer_name
      from dsb_checklist_items ci
      join dsb_developers d on d.id = ci.developer_id
     where ci.developer_id is not null
       and ci.template_id is null
  ) loop
    select checklist_template_id into new_tpl_id from dsb_developers where id = rec.developer_id;
    if new_tpl_id is null then
      insert into dsb_checklist_templates (tenant_id, name, is_default)
        values (rec.tenant_id, format('قائمة عميل %s', rec.developer_name), false)
        returning id into new_tpl_id;
      update dsb_developers set checklist_template_id = new_tpl_id where id = rec.developer_id;
    end if;
    update dsb_checklist_items set template_id = new_tpl_id where id = rec.item_id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Drop the now-redundant per-item scope columns from 052.
-- ----------------------------------------------------------------------------
--
-- We don't enforce a NOT NULL on template_id yet because seeded GLOBAL rows
-- (tenant_id IS NULL) still exist. App code treats items without a template
-- as invisible — those global seeds are no longer surfaced; tenants get
-- their own copy via the default template they created above when they
-- first had items.

alter table dsb_checklist_items
  drop constraint if exists dsb_checklist_items_scope_mutex_chk;

drop index if exists dsb_checklist_items_project_idx;
drop index if exists dsb_checklist_items_developer_idx;

alter table dsb_checklist_items
  drop column if exists project_id,
  drop column if exists developer_id;
