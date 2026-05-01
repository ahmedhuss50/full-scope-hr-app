-- 009_payroll_sync.sql
-- Accounting-system OAuth connections (QBO + Xero + Sage) and outbound sync queue.
-- Full Scope HR adds Xero + Sage (popular with GCC accounting firms) and drops Gusto / per-system
-- sync-records tables (Innuvis qbo_sync_records / gusto_sync_records). The generic
-- sync_queue + sync_events pair carries enough metadata for Phase 1.

create type sync_destination_enum as enum ('qbo','xero','sage');
create type sync_object_kind_enum as enum ('employee','vendor','pay_rate_change','termination','engagement','client');
create type sync_operation_enum   as enum ('create','update','delete');
create type sync_status_enum      as enum ('queued','in_progress','completed','failed','dead_letter');

create table qbo_connections (
  id                       uuid primary key default uuid_generate_v4(),
  tenant_id                uuid not null unique references tenants(id) on delete cascade,
  realm_id                 text not null,
  access_token_encrypted   bytea not null,
  refresh_token_encrypted  bytea not null,
  expires_at               timestamptz not null,
  environment              text not null default 'production',     -- 'sandbox' or 'production'
  active                   boolean not null default true,
  last_refreshed_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table xero_connections (
  id                       uuid primary key default uuid_generate_v4(),
  tenant_id                uuid not null unique references tenants(id) on delete cascade,
  xero_tenant_id           text not null,                          -- Xero's per-org identifier
  access_token_encrypted   bytea not null,
  refresh_token_encrypted  bytea not null,
  expires_at               timestamptz not null,
  environment              text not null default 'production',
  active                   boolean not null default true,
  last_refreshed_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table sage_connections (
  id                       uuid primary key default uuid_generate_v4(),
  tenant_id                uuid not null unique references tenants(id) on delete cascade,
  sage_business_id         text not null,                          -- Sage Accounting business identifier
  access_token_encrypted   bytea not null,
  refresh_token_encrypted  bytea not null,
  expires_at               timestamptz not null,
  environment              text not null default 'production',
  active                   boolean not null default true,
  last_refreshed_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table sync_queue (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  destination     sync_destination_enum not null,
  object_kind     sync_object_kind_enum not null,
  object_id       uuid not null,
  operation       sync_operation_enum not null,
  attempt_count   int not null default 0,
  status          sync_status_enum not null default 'queued',
  last_error      jsonb,
  queued_at       timestamptz not null default now(),
  locked_until    timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table sync_events (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  sync_queue_id     uuid not null references sync_queue(id) on delete cascade,
  status            sync_status_enum not null,
  destination       sync_destination_enum,
  request_payload   jsonb,
  response_payload  jsonb,
  http_status       int,
  error_detail      text,
  at                timestamptz not null default now()
);

create trigger trg_qbo_connections_updated_at   before update on qbo_connections   for each row execute function set_updated_at();
create trigger trg_xero_connections_updated_at  before update on xero_connections  for each row execute function set_updated_at();
create trigger trg_sage_connections_updated_at  before update on sage_connections  for each row execute function set_updated_at();
create trigger trg_sync_queue_updated_at        before update on sync_queue        for each row execute function set_updated_at();
