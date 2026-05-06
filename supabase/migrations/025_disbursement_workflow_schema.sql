-- 025_disbursement_workflow_schema.sql
-- Disbursement Document Review extension to the DMS Workflow engine.
--
-- Adds three new tables on top of 023_dms_workflows_schema.sql:
--   * dms_workflow_checklist_items     — reusable per-template checklist definitions
--   * dms_workflow_checklist_responses — per-step responses on a specific run
--   * dms_workflow_uploads             — files attached to a run by external uploaders
-- and one column on dms_workflow_signer_tokens to distinguish 'sign' vs 'upload' tokens.
--
-- KSA real-estate-developer flavor: a developer (external party, no account)
-- receives a tokenized link, uploads disbursement documents (contract, bill,
-- proof of fund, bank statement). Internal admin then walks a 19-item
-- compliance checklist (Arabic-primary), an auditor re-verifies independently,
-- and the firm owner signs off. AI assists at every stage.
--
-- RUN ORDER: depends on 001..024.
--   - relies on existing `tenants`, `users`, `set_updated_at()`,
--     `auth_tenant_id()`, `dms_workflow_templates`,
--     `dms_workflow_template_stages`, `dms_workflow_runs`,
--     `dms_workflow_run_steps`, `dms_workflow_signers`,
--     `dms_workflow_signer_tokens`.

-- ============================================================
-- 1) Enums
-- ============================================================
create type dms_checklist_item_status as enum (
  'verified',          -- ✓ item passes
  'issue',             -- ✗ item has issue
  'not_mentioned',     -- لم يذكر  (item not mentioned in document)
  'not_attached',      -- لم يرفق (supporting doc not attached)
  'pending'            -- not yet reviewed
);

-- ============================================================
-- 2) Reusable checklist definitions (per template)
-- ============================================================
create table dms_workflow_checklist_items (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  template_id       uuid not null references dms_workflow_templates(id) on delete cascade,
  template_stage_id uuid references dms_workflow_template_stages(id) on delete cascade,
  order_index       int not null,
  code              text,                       -- short code like 'DOC_SEQUENCE'
  prompt_en         text not null,              -- the question/check in English
  prompt_ar         text not null,              -- in Arabic (this workflow is AR-primary)
  hint              text,                       -- optional explanatory hint
  required          boolean not null default true,
  ai_check_capable  boolean not null default false,  -- whether AI can pre-fill
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (template_id, order_index)
);
create index on dms_workflow_checklist_items(tenant_id, template_id, order_index);

-- ============================================================
-- 3) Per-step checklist responses on a specific run
-- ============================================================
create table dms_workflow_checklist_responses (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  run_step_id         uuid not null references dms_workflow_run_steps(id) on delete cascade,
  checklist_item_id   uuid not null references dms_workflow_checklist_items(id) on delete cascade,
  status              dms_checklist_item_status not null default 'pending',
  notes               text,
  ai_suggested_status dms_checklist_item_status,    -- what AI thought
  ai_suggested_notes  text,
  ai_confidence       numeric(3,2),
  responded_by        uuid references users(id),
  responded_at        timestamptz,
  created_at          timestamptz not null default now(),
  unique (run_step_id, checklist_item_id)
);
create index on dms_workflow_checklist_responses(tenant_id, run_step_id);
create index on dms_workflow_checklist_responses(tenant_id, checklist_item_id);

-- ============================================================
-- 4) File uploads associated with workflow runs
--    (separate from dms_documents which is the firm-side library)
-- ============================================================
create table dms_workflow_uploads (
  id                     uuid primary key default uuid_generate_v4(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  run_id                 uuid not null references dms_workflow_runs(id) on delete cascade,
  run_step_id            uuid references dms_workflow_run_steps(id) on delete cascade,
  uploaded_by_signer_id  uuid references dms_workflow_signers(id),
  uploaded_by_user_id    uuid references users(id),
  filename               text not null,
  display_name           text,
  upload_kind            text,        -- 'contract','bill','proof_of_fund','bank_statement','other'
  storage_path           text,        -- supabase storage path
  storage_bucket         text default 'Document submission',
  file_size_bytes        bigint,
  mime_type              text,
  uploaded_at            timestamptz not null default now()
);
create index on dms_workflow_uploads(tenant_id, run_id, uploaded_at desc);
create index on dms_workflow_uploads(tenant_id, run_step_id);

-- ============================================================
-- 5) Token kind (sign vs upload) on dms_workflow_signer_tokens
-- ============================================================
alter table dms_workflow_signer_tokens
  add column if not exists token_kind text not null default 'sign';  -- 'sign' or 'upload'

-- ============================================================
-- 6) Triggers — updated_at
-- ============================================================
create trigger trg_dwci_updated_at
  before update on dms_workflow_checklist_items
  for each row execute function set_updated_at();
-- (responses don't need updated_at; they have responded_at)

-- ============================================================
-- 7) RLS — tenant isolation per existing pattern
-- ============================================================
alter table dms_workflow_checklist_items     enable row level security;
alter table dms_workflow_checklist_responses enable row level security;
alter table dms_workflow_uploads             enable row level security;

create policy dwci_select on dms_workflow_checklist_items     for select using (tenant_id = auth_tenant_id());
create policy dwci_modify on dms_workflow_checklist_items     for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dwcr_select on dms_workflow_checklist_responses for select using (tenant_id = auth_tenant_id());
create policy dwcr_modify on dms_workflow_checklist_responses for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy dwu_select  on dms_workflow_uploads             for select using (tenant_id = auth_tenant_id());
create policy dwu_modify  on dms_workflow_uploads             for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

-- ============================================================
-- 8) POST-MIGRATION MANUAL STEP — create the Supabase Storage bucket
-- ============================================================
-- After applying this migration, a one-time manual step is required to create
-- the Storage bucket that backs `dms_workflow_uploads`. Storage buckets via
-- raw SQL is fragile across Supabase versions; the safer path is the UI:
--
--   1. Supabase Dashboard → Storage → New bucket
--   2. Name: workflow-uploads
--   3. Public: NO  (private — signed URLs only)
--   4. File size limit: 25 MB
--   5. Allowed MIME types:
--        application/pdf
--        image/jpeg
--        image/png
--        application/msword
--        application/vnd.openxmlformats-officedocument.wordprocessingml.document
--        application/vnd.ms-excel
--        application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
--   6. After creating, in Storage → Policies, add:
--        - allow service_role full access (default)
--        - allow authenticated users SELECT/INSERT for their own tenant
--          (via a `bucket_id = 'workflow-uploads'` + tenant-prefix path check)
--
-- Until the bucket exists, the upload action will fall back to writing the
-- dms_workflow_uploads metadata row with a `storage_path` of NULL — useful
-- for demos but not for real file retrieval.
