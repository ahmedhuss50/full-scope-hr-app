-- 019_crm_schema.sql
-- CRM module — Phase 2 / PIVOT block. Adds three tenant-isolated tables:
--   crm_contacts   — people inside the firm's clients (CFO, finance manager, etc.)
--   crm_deals      — sales pipeline (lead → qualified → proposal → negotiation → won/lost)
--   crm_activities — append-style log of touches (call/email/meeting/note/task/...)
--
-- Strategy: stack on top of the existing `clients` table (extended in 015) and the
-- `engagements` table; the deal funnel is upstream of an engagement (lead before
-- it lands), and an `engagement_started` activity bridges the two when a deal is
-- won. RLS mirrors the rest of the suite (`auth_tenant_id()`).
--
-- RUN ORDER: depends on
--   001..018 (extensions, tenants/users, clients/engagements expand, DMS)
--   - relies on `set_updated_at()` (002) and `auth_tenant_id()` (012).

-- ============================================================
-- 1) Contacts
-- ============================================================
create type crm_contact_role as enum (
  'primary','finance','technical','executive','legal','procurement','assistant','other'
);

create table crm_contacts (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  full_name       text not null,
  job_title       text,
  email           text,
  mobile_phone    text,
  office_phone    text,
  role            crm_contact_role not null default 'other',
  is_primary      boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on crm_contacts(tenant_id, client_id);
create index on crm_contacts(tenant_id, is_primary) where is_primary = true;

-- ============================================================
-- 2) Deals (pipeline)
-- ============================================================
create type crm_deal_stage as enum (
  'lead','qualified','proposal','negotiation','won','lost','on_hold'
);

create table crm_deals (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  client_id           uuid not null references clients(id) on delete cascade,
  primary_contact_id  uuid references crm_contacts(id) on delete set null,
  owner_user_id       uuid references users(id),
  title               text not null,
  description         text,
  stage               crm_deal_stage not null default 'lead',
  probability         int default 20,                -- 0..100, soft default per stage
  estimated_value     numeric(14,2),
  currency            text default 'SAR',
  expected_close_date date,
  actual_close_date   date,
  service_type        text,                          -- 'Audit','Tax','Advisory','BD','Other'
  source              text,                          -- 'Referral','Website','LinkedIn','Existing Client','Cold Outreach','Event'
  lost_reason         text,
  next_step           text,
  next_step_due       date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on crm_deals(tenant_id, stage, expected_close_date);
create index on crm_deals(tenant_id, owner_user_id);
create index on crm_deals(tenant_id, client_id);

-- ============================================================
-- 3) Activities (touch log + tasks)
-- ============================================================
create type crm_activity_kind as enum (
  'call','email','meeting','note','task','proposal_sent','engagement_started'
);

create table crm_activities (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  client_id       uuid references clients(id) on delete cascade,
  deal_id         uuid references crm_deals(id) on delete set null,
  contact_id      uuid references crm_contacts(id) on delete set null,
  actor_user_id   uuid references users(id),
  kind            crm_activity_kind not null,
  subject         text not null,
  body            text,
  occurred_at     timestamptz not null default now(),
  due_at          timestamptz,                       -- for tasks
  completed       boolean,                           -- for tasks
  created_at      timestamptz not null default now()
);
create index on crm_activities(tenant_id, client_id, occurred_at desc);
create index on crm_activities(tenant_id, deal_id, occurred_at desc);
create index on crm_activities(tenant_id, actor_user_id, occurred_at desc);

-- ============================================================
-- 4) Triggers
-- ============================================================
create trigger trg_crm_contacts_updated_at before update on crm_contacts for each row execute function set_updated_at();
create trigger trg_crm_deals_updated_at    before update on crm_deals    for each row execute function set_updated_at();

-- ============================================================
-- 5) RLS — tenant isolation
-- ============================================================
alter table crm_contacts   enable row level security;
alter table crm_deals      enable row level security;
alter table crm_activities enable row level security;

create policy crm_contacts_select on crm_contacts for select using (tenant_id = auth_tenant_id());
create policy crm_contacts_modify on crm_contacts for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy crm_deals_select    on crm_deals    for select using (tenant_id = auth_tenant_id());
create policy crm_deals_modify    on crm_deals    for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy crm_activities_select on crm_activities for select using (tenant_id = auth_tenant_id());
create policy crm_activities_modify on crm_activities for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
