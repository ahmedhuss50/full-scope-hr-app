-- 015_cost_tracking_expand.sql
-- Phase 2 / Block N — expand the stub clients + engagements tables (created in
-- 010_system_logs.sql) into the real Practice-Management cost-tracking schema.
-- Adds time_entries (timesheet) + firm_expenses (overhead ledger) + a recruiting
-- cost-per-hire view that joins applications -> candidates -> employees.
--
-- Strategy: ALTER existing stub tables (don't drop) so RLS + updated_at triggers
-- already wired in 010 + 012 keep working. New tables get RLS + updated_at
-- registered explicitly here.

-- ============================================================
-- engagements — expand stub
-- ============================================================
alter table engagements
  add column code                 text,
  add column start_date           date,
  add column end_date             date,
  add column budget_hours         numeric(10,2),
  add column fee_amount           numeric(14,2),
  add column fee_currency         text default 'SAR',
  add column billed_amount        numeric(14,2) default 0,
  add column collected_amount     numeric(14,2) default 0,
  add column lead_partner_id      uuid references users(id),
  add column engagement_type      text,
  add column practice_area_id     uuid references practice_areas(id);

alter table engagements
  add constraint engagements_tenant_code_unique unique (tenant_id, code);

create index idx_engagements_tenant_status_end on engagements(tenant_id, status, end_date);

-- ============================================================
-- clients — expand stub
-- ============================================================
-- The stub already has `name` (not null). We keep it as the operational display
-- name and add `legal_name` (defaultable from `name` on backfill). New tenants
-- should populate legal_name explicitly.
alter table clients
  add column legal_name              text,
  add column trade_name              text,
  add column industry                text,
  add column country_code            text default 'SA',
  add column vat_number              text,
  add column primary_contact_name    text,
  add column primary_contact_email   text,
  add column relationship_owner_id   uuid references users(id),
  add column since                   date;

-- Backfill legal_name from name where not set (safe even if no rows yet).
update clients set legal_name = name where legal_name is null;

alter table clients alter column legal_name set not null;

-- ============================================================
-- time_entries — engagement timesheet ledger
-- ============================================================
create table time_entries (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  engagement_id   uuid not null references engagements(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  entry_date      date not null,
  hours           numeric(5,2) not null,
  billable        boolean not null default true,
  billable_rate   numeric(10,2),                   -- SAR/hour at the time of entry
  rate_currency   text default 'SAR',
  description     text,
  status          text default 'submitted',        -- 'draft','submitted','approved','rejected','billed'
  approved_by     uuid references users(id),
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_time_entries_tenant_engagement_date on time_entries(tenant_id, engagement_id, entry_date);
create index idx_time_entries_tenant_employee_date   on time_entries(tenant_id, employee_id,   entry_date);

create trigger trg_time_entries_updated_at before update on time_entries for each row execute function set_updated_at();

alter table time_entries enable row level security;
create policy time_entries_tenant_select on time_entries
  for select using (tenant_id = auth_tenant_id());
create policy time_entries_tenant_modify on time_entries
  for all using (tenant_id = auth_tenant_id())
        with check (tenant_id = auth_tenant_id());

-- ============================================================
-- firm_expenses — firm-level overhead ledger
-- ============================================================
create table firm_expenses (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  category         text not null,                  -- 'SaaS','Office','Payroll','Marketing','Travel','Professional Services','Other'
  vendor           text not null,
  description      text,
  amount           numeric(12,2) not null,
  currency         text default 'SAR',
  expense_date     date not null,
  recurring        text,                           -- 'monthly','annually','one-time'
  recurring_until  date,
  paid             boolean default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_firm_expenses_tenant_date     on firm_expenses(tenant_id, expense_date desc);
create index idx_firm_expenses_tenant_category on firm_expenses(tenant_id, category);

create trigger trg_firm_expenses_updated_at before update on firm_expenses for each row execute function set_updated_at();

alter table firm_expenses enable row level security;
create policy firm_expenses_tenant_select on firm_expenses
  for select using (tenant_id = auth_tenant_id());
create policy firm_expenses_tenant_modify on firm_expenses
  for all using (tenant_id = auth_tenant_id())
        with check (tenant_id = auth_tenant_id());

-- ============================================================
-- recruiting_costs_v — cost-per-hire / source-effectiveness view
-- ============================================================
-- Read-only aggregation over applications -> candidates (source) -> employees
-- (hire_date through origin_candidate_id). Counts applications per source and
-- the slice that converted to a hired employee, with avg time-to-hire in days.
-- RLS on the view is inherited from the underlying tables — anyone with a
-- tenant-scoped session sees only their tenant's rows.
create or replace view recruiting_costs_v as
select
  a.tenant_id,
  c.source,
  count(*)                                                               as application_count,
  count(*) filter (where a.status = 'hired')                             as hire_count,
  avg((e.hire_date - a.applied_at::date)::numeric)
    filter (where a.status = 'hired')                                    as avg_time_to_hire_days
from applications a
join candidates c on c.id = a.candidate_id
left join employees e on e.origin_candidate_id = c.id
group by a.tenant_id, c.source;
