-- 017_dms_schema.sql
-- Document Management System (DMS) schema — Phase 2 / Suite shell extension.
-- Folders + Documents + append-only access log. Documents may be tied to a
-- client + engagement, or to firm-internal folders (HR, Templates, Firm Admin).
--
-- KSA accounting-firm flavor: 7-year retention default, sensitivity classification,
-- access-log inheritance from DEC-009 (append-only audit pattern).
--
-- RUN ORDER: depends on
--   001..016 schema + seeds
--   - relies on existing `clients`, `engagements`, `users`, `tenants`, `set_updated_at()`,
--     `auth_tenant_id()` from earlier migrations.

-- ============================================================
-- 1) Enums
-- ============================================================
create type dms_folder_kind as enum (
  'engagement','client_general','firm_admin','hr','templates','archive'
);

create type dms_doc_status as enum (
  'draft','final','signed','archived','superseded'
);

create type dms_sensitivity as enum (
  'public','internal','confidential','restricted'
);

-- ============================================================
-- 2) Folders
-- ============================================================
create table dms_folders (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  parent_id     uuid references dms_folders(id) on delete cascade,
  client_id     uuid references clients(id) on delete cascade,        -- nullable: firm-internal folders
  engagement_id uuid references engagements(id) on delete set null,   -- nullable
  name          text not null,
  kind          dms_folder_kind not null default 'client_general',
  description   text,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on dms_folders(tenant_id, client_id);
create index on dms_folders(tenant_id, parent_id);

-- ============================================================
-- 3) Documents
-- ============================================================
create table dms_documents (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  folder_id       uuid not null references dms_folders(id) on delete cascade,
  client_id       uuid references clients(id) on delete cascade,
  engagement_id   uuid references engagements(id) on delete set null,
  filename        text not null,
  display_name    text,
  description     text,
  file_url        text,                                            -- Supabase Storage path; null in seed
  file_size_bytes bigint,
  mime_type       text,
  doc_kind        text,                                            -- 'engagement_letter','financial_statement','tax_return','working_paper','other'
  sensitivity     dms_sensitivity not null default 'confidential',
  status          dms_doc_status not null default 'final',
  version_number  int not null default 1,
  retention_until date,                                            -- KSA 7-year retention default
  uploaded_by     uuid references users(id),
  uploaded_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on dms_documents(tenant_id, client_id, uploaded_at desc);
create index on dms_documents(tenant_id, folder_id);
create index on dms_documents(tenant_id, status);

-- ============================================================
-- 4) Access log — append-only (DEC-009 pattern)
-- ============================================================
create table dms_access_log (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  document_id   uuid not null references dms_documents(id) on delete cascade,
  actor_user_id uuid references users(id),
  action        text not null,    -- 'view','download','share','rename','version_upload','delete_attempt'
  notes         text,
  ip_address    text,
  occurred_at   timestamptz not null default now()
);
create index on dms_access_log(tenant_id, document_id, occurred_at desc);
create index on dms_access_log(tenant_id, actor_user_id, occurred_at desc);

-- ============================================================
-- 5) Triggers — updated_at
-- ============================================================
create trigger trg_dms_folders_updated_at   before update on dms_folders   for each row execute function set_updated_at();
create trigger trg_dms_documents_updated_at before update on dms_documents for each row execute function set_updated_at();

-- ============================================================
-- 6) RLS — tenant isolation per existing pattern
-- ============================================================
alter table dms_folders    enable row level security;
alter table dms_documents  enable row level security;
alter table dms_access_log enable row level security;

create policy dms_folders_tenant_select  on dms_folders   for select using (tenant_id = auth_tenant_id());
create policy dms_folders_tenant_modify  on dms_folders   for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dms_docs_tenant_select     on dms_documents for select using (tenant_id = auth_tenant_id());
create policy dms_docs_tenant_modify     on dms_documents for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

-- Access log is append-only
create policy dms_access_log_append_only on dms_access_log for insert with check (tenant_id = auth_tenant_id());
create policy dms_access_log_select      on dms_access_log for select using (tenant_id = auth_tenant_id());
revoke update, delete on dms_access_log from public;
