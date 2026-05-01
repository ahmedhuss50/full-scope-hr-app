-- 010_system_logs.sql
-- System-level logs, notifications, translations, plus Phase 2/3 stub tables
-- so the RLS template in 012 applies cleanly when those features land.

create type pii_reason_code_enum as enum (
  'VIEW','EDIT','EXPORT','SYNC_QBO','SYNC_XERO','SYNC_SAGE','CLASSIFICATION_CHANGE','SYSTEM'
);

create type pii_sensitivity_enum as enum (
  'PUBLIC','INTERNAL','PII','SENSITIVE-PII','RESTRICTED'
);

create table audit_log (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  actor_user_id   uuid references users(id),
  entity_kind     text not null,
  entity_id       uuid,
  action          text not null,                  -- 'create','update','delete','login','status_change'
  before_state    jsonb,
  after_state     jsonb,
  actor_ip        text,
  user_agent      text,
  at              timestamptz not null default now()
);

create table pii_access_log (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  actor_user_id   uuid references users(id),
  entity_kind     text not null,
  entity_id       uuid not null,
  field_accessed  text not null,
  sensitivity     pii_sensitivity_enum not null,
  reason_code     pii_reason_code_enum not null,
  actor_ip        text,
  at              timestamptz not null default now()
);

create type notification_channel_enum as enum ('email','sms','whatsapp');

create table notification_templates (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  key         text not null,
  channel     notification_channel_enum not null,
  locale      text not null default 'en',         -- 'en' | 'ar'
  subject     text,
  body        text not null,
  variables   jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, key, channel, locale)
);

create type notification_status_enum as enum ('queued','sent','delivered','failed','bounced');

create table notification_log (
  id                     uuid primary key default uuid_generate_v4(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  channel                notification_channel_enum not null,
  recipient              text not null,
  template_id            uuid references notification_templates(id),
  locale                 text not null default 'en',
  status                 notification_status_enum not null default 'queued',
  provider_message_id    text,
  payload                jsonb,
  error_detail           text,
  sent_at                timestamptz,
  created_at             timestamptz not null default now()
);

create table translations (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references tenants(id) on delete cascade,    -- null = global/default
  key         text not null,
  en          text not null,
  ar          text not null,
  context     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, key)
);

-- ============================================================
-- Phase 2 / Phase 3 stub tables.
-- Created here so migration 012 can apply standard tenant-isolation RLS uniformly.
-- Full schemas land in: clients/engagements -> N3 (Phase 2 PM),
-- employee_credentials/firm_credentials -> O2 (Phase 3 Cert).
-- ============================================================

-- STUB: full schema in Phase 2 N3
create table clients (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- STUB: full schema in Phase 2 N3
create table engagements (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  name        text not null,
  status      text not null default 'planned',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- STUB: full schema in Phase 3 O2
create table employee_credentials (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  credential_type text not null,
  status          text not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- STUB: full schema in Phase 3 O2
create table firm_credentials (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  credential_type text not null,
  status          text not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_notification_templates_updated_at before update on notification_templates for each row execute function set_updated_at();
create trigger trg_translations_updated_at           before update on translations           for each row execute function set_updated_at();
create trigger trg_clients_updated_at                before update on clients                for each row execute function set_updated_at();
create trigger trg_engagements_updated_at            before update on engagements            for each row execute function set_updated_at();
create trigger trg_employee_credentials_updated_at   before update on employee_credentials   for each row execute function set_updated_at();
create trigger trg_firm_credentials_updated_at       before update on firm_credentials       for each row execute function set_updated_at();
