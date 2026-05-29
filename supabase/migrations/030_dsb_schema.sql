-- 030_dsb_schema.sql
-- ============================================================================
-- DISBURSEMENT WORKFLOW (الصرف) — schema
-- ============================================================================
-- A deliberately simple, Arabic-only disbursement workflow that REPLACES the
-- earlier Escrow Control module for day-to-day operations. Four roles handle
-- one combined PDF per disbursement case, with email notifications at every
-- transition:
--
--   developer  → uploads ONE PDF per case (voucher + invoices + proofs combined)
--   employee   → reviews + breaks the PDF down into typed rows
--   supervisor → second approval
--   owner      → Mahdi — gives the final signature
--
-- Status flow:
--   draft → with_employee → with_supervisor → with_owner → signed
--   (any of the three review stages can branch to: sent_back_to_developer,
--    which then loops back to with_employee on resubmission)
--
-- Multi-tenant via tenant_id + RLS, identical pattern to the rest of Full Scope.
--
-- RUN ORDER: depends on 001..029.
--   - relies on `tenants`, `users`, `set_updated_at()`, `auth_tenant_id()`.
-- ============================================================================

-- ============================================================
-- 1) Enums
-- ============================================================
create type dsb_role as enum ('developer','employee','supervisor','owner');

create type dsb_case_status as enum (
  'draft',
  'with_employee',
  'with_supervisor',
  'with_owner',
  'sent_back_to_developer',
  'signed',
  'cancelled'
);

create type dsb_breakdown_kind as enum (
  'voucher',
  'invoice',
  'proof_of_payment',
  'completion_certificate',
  'contract',
  'receipt',
  'other'
);

-- ============================================================
-- 2) Per-user role tag
-- ============================================================
-- One column on the existing users table — keeps the workflow self-contained
-- without rebuilding the roles system.
alter table users add column if not exists dsb_role dsb_role;

-- ============================================================
-- 3) Projects — each assigned to ONE employee
-- ============================================================
create table dsb_projects (
  id                    uuid primary key default uuid_generate_v4(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  code                  text not null,
  name_ar               text not null,
  assigned_employee_id  uuid references users(id),
  status                text not null default 'active',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, code)
);

-- ============================================================
-- 4) Developers — one row per developer company, linked to one user login
-- ============================================================
create table dsb_developers (
  id                 uuid primary key default uuid_generate_v4(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  company_name_ar    text not null,
  contact_name       text,
  contact_email      text not null,
  user_id            uuid references users(id),  -- their login account (nullable until created)
  status             text not null default 'active',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ============================================================
-- 5) Cases — a developer submits ONE case = ONE combined PDF + metadata
-- ============================================================
create table dsb_cases (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  project_id           uuid not null references dsb_projects(id),
  developer_id         uuid not null references dsb_developers(id),
  case_number          text not null,           -- auto-numbered DSB-NNNN
  voucher_number_text  text,                    -- whatever the developer typed
  voucher_date         date,
  amount_sar           numeric(18,2),
  status               dsb_case_status not null default 'draft',
  submitted_at         timestamptz,
  signed_at            timestamptz,
  signed_by_user_id    uuid references users(id),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, case_number)
);

-- ============================================================
-- 6) Uploads — the PDF the developer uploads (usually 1 per case)
-- ============================================================
create table dsb_uploads (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  case_id              uuid not null references dsb_cases(id) on delete cascade,
  filename             text not null,
  storage_path         text,
  storage_bucket       text default 'Document submission',
  file_size_bytes      bigint,
  mime_type            text,
  page_count           int,
  uploaded_at          timestamptz not null default now(),
  uploaded_by_user_id  uuid references users(id)
);

-- ============================================================
-- 7) Breakdown items — employee tags page ranges as different doc types
-- ============================================================
create table dsb_breakdown_items (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  case_id             uuid not null references dsb_cases(id) on delete cascade,
  upload_id           uuid references dsb_uploads(id) on delete set null,
  kind                dsb_breakdown_kind not null,
  page_from           int,
  page_to             int,
  summary_ar          text,
  source              text not null default 'human',  -- 'human' | 'ai'
  order_index         int not null default 0,
  created_by_user_id  uuid references users(id),
  created_at          timestamptz not null default now()
);

-- ============================================================
-- 8) Notes — between roles; is_change_request=true means a "send back"
-- ============================================================
create table dsb_notes (
  id                 uuid primary key default uuid_generate_v4(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  case_id            uuid not null references dsb_cases(id) on delete cascade,
  from_user_id       uuid references users(id),
  from_role          dsb_role,
  to_role            dsb_role,
  body_ar            text not null,
  is_change_request  boolean not null default false,
  created_at         timestamptz not null default now()
);

-- ============================================================
-- 9) Audit log — every stage transition recorded
-- ============================================================
create table dsb_audit_log (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  case_id         uuid not null references dsb_cases(id) on delete cascade,
  event           text not null,  -- 'uploaded' | 'employee_approved' | 'supervisor_approved' | 'sent_back' | 'signed' | 'cancelled' | 'resubmitted'
  actor_user_id   uuid references users(id),
  from_status     dsb_case_status,
  to_status       dsb_case_status,
  notes           text,
  occurred_at     timestamptz not null default now()
);

-- ============================================================
-- 10) Triggers — updated_at
-- ============================================================
create trigger trg_dsb_projects_updated_at   before update on dsb_projects   for each row execute function set_updated_at();
create trigger trg_dsb_developers_updated_at before update on dsb_developers for each row execute function set_updated_at();
create trigger trg_dsb_cases_updated_at      before update on dsb_cases      for each row execute function set_updated_at();

-- ============================================================
-- 11) RLS
-- ============================================================
alter table dsb_projects        enable row level security;
alter table dsb_developers      enable row level security;
alter table dsb_cases           enable row level security;
alter table dsb_uploads         enable row level security;
alter table dsb_breakdown_items enable row level security;
alter table dsb_notes           enable row level security;
alter table dsb_audit_log       enable row level security;

create policy dsb_proj_sel on dsb_projects        for select using (tenant_id = auth_tenant_id());
create policy dsb_proj_mod on dsb_projects        for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

create policy dsb_dev_sel  on dsb_developers      for select using (tenant_id = auth_tenant_id());
create policy dsb_dev_mod  on dsb_developers      for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

create policy dsb_case_sel on dsb_cases           for select using (tenant_id = auth_tenant_id());
create policy dsb_case_mod on dsb_cases           for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

create policy dsb_up_sel   on dsb_uploads         for select using (tenant_id = auth_tenant_id());
create policy dsb_up_mod   on dsb_uploads         for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

create policy dsb_bd_sel   on dsb_breakdown_items for select using (tenant_id = auth_tenant_id());
create policy dsb_bd_mod   on dsb_breakdown_items for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

create policy dsb_n_sel    on dsb_notes           for select using (tenant_id = auth_tenant_id());
create policy dsb_n_mod    on dsb_notes           for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

create policy dsb_log_sel  on dsb_audit_log       for select using (tenant_id = auth_tenant_id());
create policy dsb_log_mod  on dsb_audit_log       for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

-- ============================================================
-- 12) Helpful indexes
-- ============================================================
create index dsb_cases_tenant_status_idx       on dsb_cases (tenant_id, status);
create index dsb_cases_project_idx             on dsb_cases (project_id);
create index dsb_cases_developer_idx           on dsb_cases (developer_id);
create index dsb_notes_case_idx                on dsb_notes (case_id, created_at desc);
create index dsb_audit_log_case_idx            on dsb_audit_log (case_id, occurred_at desc);
create index dsb_breakdown_items_case_idx      on dsb_breakdown_items (case_id, order_index);
create index dsb_uploads_case_idx              on dsb_uploads (case_id, uploaded_at desc);
