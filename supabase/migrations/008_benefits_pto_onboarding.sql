-- 008_benefits_pto_onboarding.sql
-- Benefits, PTO, and per-role onboarding knowledge base.
-- Onboarding role classification adapted to Full Scope HR practice areas
-- (audit/tax/advisory/bd/admin) instead of W-2/1099 split.

create table benefits_classes (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  name                 text not null,
  waiting_period_days  int not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, name)
);

create type benefit_kind_enum as enum (
  'medical','dental','vision','life','ad_d','std','ltd','retirement','gosi',
  'end_of_service','housing_allowance','transport_allowance','custom'
);

create table benefit_plans (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  benefits_class_id   uuid references benefits_classes(id),
  kind                benefit_kind_enum not null,
  carrier             text,
  plan_name           text not null,
  tiers               jsonb not null default '[]'::jsonb,  -- [{tier:"EE",premium:..},...]
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create type benefit_tier_enum as enum ('EE','EE+Spouse','EE+Child','Family','Waived');

create table benefit_enrollments (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  benefit_plan_id  uuid not null references benefit_plans(id),
  tier             benefit_tier_enum not null,
  effective_date   date not null,
  end_date         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table pto_policies (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  name             text not null,
  accrual_config   jsonb not null default '{}'::jsonb,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, name)
);

create table pto_balances (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  employee_id       uuid not null references employees(id) on delete cascade,
  pto_policy_id     uuid not null references pto_policies(id),
  balance_hours     numeric(10,2) not null default 0,
  last_accrual_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (employee_id, pto_policy_id)
);

create type pto_txn_kind_enum as enum ('accrual','usage','adjustment','payout','expiration');

create table pto_transactions (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  pto_balance_id   uuid not null references pto_balances(id) on delete cascade,
  hours            numeric(10,2) not null,
  kind             pto_txn_kind_enum not null,
  notes            text,
  at               timestamptz not null default now()
);

-- Practice-area classification for onboarding role tracks (Full Scope HR delta)
create type onboarding_classification_enum as enum (
  'audit','tax','advisory','bd','admin','partner_track','support'
);

create table onboarding_roles (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  name              text not null,
  classification    onboarding_classification_enum,
  practice_area_id  uuid references practice_areas(id),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, name)
);

create table onboarding_tracks (
  id                    uuid primary key default uuid_generate_v4(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  onboarding_role_id    uuid not null references onboarding_roles(id) on delete cascade,
  name                  text not null,
  order_index           int not null default 0,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create type onboarding_module_kind as enum ('video','doc','quiz','signoff','checkin','engagement_walkthrough');

create table onboarding_modules (
  id                    uuid primary key default uuid_generate_v4(),
  onboarding_track_id   uuid not null references onboarding_tracks(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  kind                  onboarding_module_kind not null,
  title                 text not null,
  content_ref           text,
  duration_minutes      int,
  required              boolean not null default true,
  order_index           int not null default 0,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table onboarding_completions (
  id                    uuid primary key default uuid_generate_v4(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  employee_id           uuid not null references employees(id) on delete cascade,
  onboarding_module_id  uuid not null references onboarding_modules(id) on delete cascade,
  completed_at          timestamptz not null default now(),
  score                 int,
  created_at            timestamptz not null default now(),
  unique (employee_id, onboarding_module_id)
);

create trigger trg_benefits_classes_updated_at   before update on benefits_classes   for each row execute function set_updated_at();
create trigger trg_benefit_plans_updated_at      before update on benefit_plans      for each row execute function set_updated_at();
create trigger trg_benefit_enrollments_updated_at before update on benefit_enrollments for each row execute function set_updated_at();
create trigger trg_pto_policies_updated_at       before update on pto_policies       for each row execute function set_updated_at();
create trigger trg_pto_balances_updated_at       before update on pto_balances       for each row execute function set_updated_at();
create trigger trg_onboarding_roles_updated_at   before update on onboarding_roles   for each row execute function set_updated_at();
create trigger trg_onboarding_tracks_updated_at  before update on onboarding_tracks  for each row execute function set_updated_at();
create trigger trg_onboarding_modules_updated_at before update on onboarding_modules for each row execute function set_updated_at();
