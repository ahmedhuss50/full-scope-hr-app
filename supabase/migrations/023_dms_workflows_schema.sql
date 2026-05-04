-- 023_dms_workflows_schema.sql
-- DMS Multi-stage Document Approval Workflow.
--
-- A workflow ties a document to an ordered set of stages, each requiring
-- a signer (internal user OR external email-only signer) to approve or
-- reject. External signers receive a tokenized public link so they can
-- approve without a Full Scope account. Each stage may carry an AI
-- analysis to help the signer decide.
--
-- KSA accounting-firm flavor: signers commonly include client CFO (external)
-- and then internal review + final partner sign-off; ZATCA-friendly audit
-- log on every event (DEC-009 append-only pattern).
--
-- RUN ORDER: depends on
--   001..022 schema + seeds
--   - relies on existing `tenants`, `users`, `clients`, `engagements`,
--     `dms_documents`, `set_updated_at()`, `auth_tenant_id()`.

-- ============================================================
-- 1) Enums
-- ============================================================
create type dms_workflow_stage_kind as enum (
  'intake',           -- internal: doc received, AI runs, send to client
  'client_signature', -- external: client signs
  'end_customer',     -- external: end customer reviews/signs
  'internal_review',  -- internal: firm manager reviews
  'final_approval',   -- internal: owner final sign-off
  'archived'          -- terminal: completed
);

create type dms_workflow_run_status as enum (
  'in_progress',
  'awaiting_signer',
  'completed',
  'rejected',
  'cancelled',
  'expired'
);

create type dms_workflow_step_status as enum (
  'pending',          -- not yet active
  'awaiting',         -- active, waiting on signer
  'approved',
  'rejected',
  'skipped'
);

create type dms_signer_kind as enum (
  'internal_user',    -- staff member with login
  'external'          -- email-only, no account
);

create type dms_signature_decision as enum (
  'approve',
  'reject'
);

-- ============================================================
-- 2) Templates
-- ============================================================
create table dms_workflow_templates (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,
  description     text,
  doc_kinds       text[] default array[]::text[],
  active          boolean not null default true,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on dms_workflow_templates(tenant_id, active);

create table dms_workflow_template_stages (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  template_id     uuid not null references dms_workflow_templates(id) on delete cascade,
  order_index     int not null,
  kind            dms_workflow_stage_kind not null,
  name            text not null,
  signer_kind     dms_signer_kind not null,
  ai_analysis_prompt text,
  notify_template_id uuid,
  required        boolean not null default true,
  unique (template_id, order_index)
);
create index on dms_workflow_template_stages(tenant_id, template_id, order_index);

-- ============================================================
-- 3) Runs + steps
-- ============================================================
create table dms_workflow_runs (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  template_id     uuid references dms_workflow_templates(id) on delete set null,
  document_id     uuid not null references dms_documents(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  engagement_id   uuid references engagements(id) on delete set null,
  initiated_by    uuid references users(id),
  status          dms_workflow_run_status not null default 'in_progress',
  current_step_id uuid,                    -- FK self-reference; resolved logically
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on dms_workflow_runs(tenant_id, status, started_at desc);
create index on dms_workflow_runs(tenant_id, document_id);

create table dms_workflow_run_steps (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  run_id          uuid not null references dms_workflow_runs(id) on delete cascade,
  template_stage_id uuid references dms_workflow_template_stages(id) on delete set null,
  order_index     int not null,
  kind            dms_workflow_stage_kind not null,
  name            text not null,
  signer_kind     dms_signer_kind not null,
  status          dms_workflow_step_status not null default 'pending',
  activated_at    timestamptz,
  completed_at    timestamptz,
  rejected_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on dms_workflow_run_steps(tenant_id, run_id, order_index);

-- ============================================================
-- 4) Signers + tokens
-- ============================================================
create table dms_workflow_signers (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  run_step_id     uuid not null references dms_workflow_run_steps(id) on delete cascade,
  signer_kind     dms_signer_kind not null,
  internal_user_id uuid references users(id),
  external_name   text,
  external_email  text,
  external_role   text,
  notify_sent_at  timestamptz,
  created_at      timestamptz not null default now()
);
create index on dms_workflow_signers(tenant_id, run_step_id);
create index on dms_workflow_signers(tenant_id, internal_user_id);
create index on dms_workflow_signers(tenant_id, external_email);

create table dms_workflow_signer_tokens (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  signer_id       uuid not null references dms_workflow_signers(id) on delete cascade,
  token           text not null unique,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  view_count      int not null default 0,
  created_at      timestamptz not null default now()
);
create index on dms_workflow_signer_tokens(token);
create index on dms_workflow_signer_tokens(tenant_id, signer_id);

-- ============================================================
-- 5) Signatures + AI analyses + audit
-- ============================================================
create table dms_workflow_signatures (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  run_step_id     uuid not null references dms_workflow_run_steps(id) on delete cascade,
  signer_id       uuid not null references dms_workflow_signers(id) on delete cascade,
  decision        dms_signature_decision not null,
  reason          text,
  signer_ip       text,
  signer_user_agent text,
  signed_at       timestamptz not null default now()
);
create index on dms_workflow_signatures(tenant_id, run_step_id);

create table dms_workflow_ai_analyses (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  run_id          uuid not null references dms_workflow_runs(id) on delete cascade,
  run_step_id     uuid references dms_workflow_run_steps(id) on delete cascade,
  prompt          text,
  model           text,
  summary         text not null,
  key_points      text[] default array[]::text[],
  risk_flags      text[] default array[]::text[],
  recommendation  text,
  confidence      numeric(3,2),
  raw_output      jsonb,
  generated_at    timestamptz not null default now()
);
create index on dms_workflow_ai_analyses(tenant_id, run_id, generated_at desc);

create table dms_workflow_audit_log (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  run_id          uuid not null references dms_workflow_runs(id) on delete cascade,
  run_step_id     uuid references dms_workflow_run_steps(id) on delete set null,
  actor_kind      text not null,
  actor_user_id   uuid references users(id),
  actor_signer_id uuid references dms_workflow_signers(id),
  action          text not null,
  details         jsonb,
  ip_address      text,
  occurred_at     timestamptz not null default now()
);
create index on dms_workflow_audit_log(tenant_id, run_id, occurred_at desc);

-- ============================================================
-- 6) Triggers — updated_at
-- ============================================================
create trigger trg_dms_workflow_templates_updated_at  before update on dms_workflow_templates  for each row execute function set_updated_at();
create trigger trg_dms_workflow_runs_updated_at      before update on dms_workflow_runs      for each row execute function set_updated_at();
create trigger trg_dms_workflow_run_steps_updated_at before update on dms_workflow_run_steps for each row execute function set_updated_at();

-- ============================================================
-- 7) RLS — tenant isolation per existing pattern
-- ============================================================
alter table dms_workflow_templates       enable row level security;
alter table dms_workflow_template_stages enable row level security;
alter table dms_workflow_runs            enable row level security;
alter table dms_workflow_run_steps       enable row level security;
alter table dms_workflow_signers         enable row level security;
alter table dms_workflow_signer_tokens   enable row level security;
alter table dms_workflow_signatures      enable row level security;
alter table dms_workflow_ai_analyses     enable row level security;
alter table dms_workflow_audit_log       enable row level security;

create policy dwt_select  on dms_workflow_templates       for select using (tenant_id = auth_tenant_id());
create policy dwt_modify  on dms_workflow_templates       for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dwts_select on dms_workflow_template_stages for select using (tenant_id = auth_tenant_id());
create policy dwts_modify on dms_workflow_template_stages for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dwr_select  on dms_workflow_runs            for select using (tenant_id = auth_tenant_id());
create policy dwr_modify  on dms_workflow_runs            for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dwrs_select on dms_workflow_run_steps       for select using (tenant_id = auth_tenant_id());
create policy dwrs_modify on dms_workflow_run_steps       for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dws_select  on dms_workflow_signers         for select using (tenant_id = auth_tenant_id());
create policy dws_modify  on dms_workflow_signers         for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dwst_select on dms_workflow_signer_tokens   for select using (tenant_id = auth_tenant_id());
create policy dwst_modify on dms_workflow_signer_tokens   for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dwsig_select on dms_workflow_signatures     for select using (tenant_id = auth_tenant_id());
create policy dwsig_insert on dms_workflow_signatures     for insert with check (tenant_id = auth_tenant_id());
create policy dwa_select  on dms_workflow_ai_analyses     for select using (tenant_id = auth_tenant_id());
create policy dwa_insert  on dms_workflow_ai_analyses     for insert with check (tenant_id = auth_tenant_id());
create policy dwal_select on dms_workflow_audit_log       for select using (tenant_id = auth_tenant_id());
create policy dwal_insert on dms_workflow_audit_log       for insert with check (tenant_id = auth_tenant_id());

revoke update, delete on dms_workflow_audit_log from public;
revoke update, delete on dms_workflow_signatures from public;
revoke update, delete on dms_workflow_ai_analyses from public;
