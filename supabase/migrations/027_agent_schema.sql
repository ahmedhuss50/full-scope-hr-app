-- 027_agent_schema.sql
-- AI Agent runtime tables for the Disbursement Workflow.
--
-- Adds two tables on top of 025_disbursement_workflow_schema.sql:
--   * dms_workflow_agent_runs    — one row per agent invocation on a run
--   * dms_workflow_agent_actions — audit trail of every action the agent took
--
-- The agent reads checklist items + uploaded document metadata, calls Claude
-- per item, optionally auto-fills high-confidence responses, and (when
-- auto_advance is on AND no issues remain) calls signWorkflowStep to advance
-- the workflow stage. Cost + token usage tracked per run for transparency.
--
-- RUN ORDER: depends on 001..026.
--   - relies on existing `tenants`, `users`, `set_updated_at()`,
--     `auth_tenant_id()`, `dms_workflow_runs`, `dms_workflow_run_steps`.

-- ============================================================
-- 1) Enums
-- ============================================================
create type agent_run_status as enum (
  'queued','running','completed','failed','cancelled'
);

create type agent_action_kind as enum (
  'read_document',
  'analyze_checklist_item',
  'fill_checklist_response',
  'advance_stage',
  'reject_stage',
  'send_notification',
  'log_observation'
);

create type agent_action_status as enum (
  'success','failure','skipped'
);

-- ============================================================
-- 2) One row per agent invocation on a workflow run
-- ============================================================
create table dms_workflow_agent_runs (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  run_id          uuid not null references dms_workflow_runs(id) on delete cascade,
  run_step_id     uuid references dms_workflow_run_steps(id) on delete set null,
  invoked_by_user_id uuid references users(id),
  status          agent_run_status not null default 'queued',
  model           text,                       -- e.g., 'claude-sonnet-4-5-20250929'
  confidence_threshold numeric(3,2) default 0.85, -- agent only auto-acts when above
  auto_advance    boolean not null default false,
  total_tokens_in  int default 0,
  total_tokens_out int default 0,
  cost_usd        numeric(8,4) default 0,
  started_at      timestamptz,
  completed_at    timestamptz,
  error_message   text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on dms_workflow_agent_runs(tenant_id, run_id, started_at desc);
create index on dms_workflow_agent_runs(tenant_id, status);

-- ============================================================
-- 3) Each individual action the agent took
-- ============================================================
create table dms_workflow_agent_actions (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  agent_run_id    uuid not null references dms_workflow_agent_runs(id) on delete cascade,
  order_index     int not null,
  kind            agent_action_kind not null,
  status          agent_action_status not null default 'success',
  target_kind     text,                       -- 'checklist_item','document','step'
  target_id       uuid,
  input_summary   text,                       -- short description of input
  output_summary  text,                       -- short description of output / decision
  confidence      numeric(3,2),
  reasoning       text,                       -- agent's reasoning for the decision
  prompt_tokens   int,
  completion_tokens int,
  duration_ms     int,
  occurred_at     timestamptz not null default now()
);
create index on dms_workflow_agent_actions(tenant_id, agent_run_id, order_index);

-- ============================================================
-- 4) Triggers — updated_at
-- ============================================================
create trigger trg_dwar_updated_at before update on dms_workflow_agent_runs for each row execute function set_updated_at();

-- ============================================================
-- 5) RLS — tenant isolation per existing pattern
-- ============================================================
alter table dms_workflow_agent_runs    enable row level security;
alter table dms_workflow_agent_actions enable row level security;

create policy dwar_select on dms_workflow_agent_runs    for select using (tenant_id = auth_tenant_id());
create policy dwar_modify on dms_workflow_agent_runs    for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dwaa_select on dms_workflow_agent_actions for select using (tenant_id = auth_tenant_id());
create policy dwaa_modify on dms_workflow_agent_actions for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
