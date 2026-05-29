-- 028_escrow_schema.sql
-- ============================================================================
-- ESCROW CONTROL MODULE — schema
-- ============================================================================
-- For Saudi real-estate escrow trustees (أمين الحساب). The trustee sits
-- between developers, contractors, and buyers as the financial control layer.
--
-- Two sides:
--   (1) OUTFLOW — every payment voucher (وثيقة صرف) issued by a developer
--       gets audited against contracts, invoices, completion certificates,
--       escrow balances, and authorized-signer rules. 13 rules total.
--   (2) INFLOW — buyer deposits land in segregated escrow accounts and get
--       auto-allocated across construction (76%), non-construction (20%),
--       and preservation (4%) per Saudi regulation.
--
-- Multi-tenant via tenant_id + RLS, same pattern as the rest of Full Scope.
--
-- RUN ORDER: depends on 001..027.
--   - relies on `tenants`, `users`, `set_updated_at()`, `auth_tenant_id()`.
-- ============================================================================

-- ============================================================
-- 1) Enums
-- ============================================================
create type escrow_account_type as enum (
  'construction',       -- حساب الضمان الإنشائي  (receives 76% of buyer deposits)
  'non_construction',   -- حساب الضمان غير الإنشائي  (receives 20%)
  'preservation'        -- حساب الحفظ  (receives 4%)
);

create type escrow_voucher_status as enum (
  'draft',              -- being prepared, no docs yet
  'uploaded',           -- docs uploaded, not yet audited
  'agent_running',      -- agent currently auditing
  'needs_review',       -- agent finished with warnings, human must decide
  'approved',           -- trustee approved
  'rejected',           -- trustee or agent rejected (blocking rule failed)
  'paid',               -- bank transfer executed
  'cancelled'
);

create type escrow_invoice_status as enum (
  'open',               -- not yet paid
  'partially_paid',     -- some vouchers applied, not fully covered
  'paid',               -- fully covered by one or more vouchers
  'disputed',           -- flagged for review (e.g., addressed to wrong developer)
  'void'
);

create type escrow_supplier_status as enum (
  'pending_approval',   -- new supplier, awaiting manual approval
  'approved',           -- repeat supplier (seen 2+ times) or manually approved
  'rejected',
  'inactive'
);

create type escrow_upload_kind as enum (
  'voucher',                -- the payment voucher itself
  'invoice',                -- supplier invoice
  'completion_certificate', -- شهادة إنجاز from engineering supervisor
  'contractor_extract',     -- مستخلص (contractor's progress claim)
  'signed_approval',        -- internal approval signed by authorized signer
  'receipt_confirmation',   -- delivery confirmation / service acceptance
  'supplier_contract',      -- the underlying supplier contract
  'supplier_ledger',        -- كشف حساب المورد from developer's accounting
  'bank_statement',
  'other',
  'unknown'                 -- agent couldn't classify
);

create type escrow_check_status as enum (
  'pass',
  'fail',
  'warn',
  'needs_info',         -- agent needs more docs or master data
  'skipped'
);

create type escrow_check_severity as enum (
  'blocking',           -- voucher cannot be approved if this fails
  'warning',            -- human must decide
  'info'
);

create type escrow_agent_run_status as enum (
  'queued','running','completed','failed','cancelled'
);

create type escrow_deposit_status as enum (
  'parsed',             -- read from bank statement, not yet allocated
  'allocated',          -- 76/20/4 split computed
  'posted',             -- movements written to escrow_account_movements
  'unmatched'           -- couldn't be matched to a buyer/unit
);

create type escrow_movement_kind as enum (
  'deposit','withdrawal','transfer_in','transfer_out','adjustment'
);

-- ============================================================
-- 2) Developers — the firms whose escrow accounts the trustee manages
-- ============================================================
create table escrow_developers (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name_en         text not null,
  name_ar         text,
  cr_number       text,                       -- commercial registration
  vat_number      text,
  contact_email   text,
  contact_phone   text,
  status          text not null default 'active',  -- 'active' | 'inactive'
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on escrow_developers(tenant_id, name_en);

-- ============================================================
-- 3) Projects — each project = its own balance sheet & master data
-- ============================================================
create table escrow_projects (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  developer_id    uuid not null references escrow_developers(id) on delete restrict,
  code            text not null,              -- e.g., ST0026 / MADRA-P2
  name_en         text not null,
  name_ar         text,
  description     text,
  location_en     text,
  location_ar     text,
  status          text not null default 'active',   -- 'active' | 'completed' | 'on_hold'
  start_date      date,
  expected_completion_date date,
  total_budget_sar numeric(18,2),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, code)
);
create index on escrow_projects(tenant_id, developer_id);
create index on escrow_projects(tenant_id, status);

-- ============================================================
-- 4) Escrow accounts — 3 per project (construction / non-construction / preservation)
-- ============================================================
create table escrow_accounts (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  project_id          uuid not null references escrow_projects(id) on delete cascade,
  account_type        escrow_account_type not null,
  bank_name           text,
  iban                text,
  account_number      text,
  opening_balance_sar numeric(18,2) not null default 0,
  current_balance_sar numeric(18,2) not null default 0,
  last_balance_at     timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, account_type)
);
create index on escrow_accounts(tenant_id, project_id);

-- ============================================================
-- 5) Authorized signers per developer (for rule #11)
-- ============================================================
create table escrow_authorized_signers (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  developer_id      uuid not null references escrow_developers(id) on delete cascade,
  name              text not null,
  title             text,
  email             text,
  phone             text,
  signature_specimen_path text,  -- storage path of signature image for visual match
  signing_limit_sar numeric(18,2),    -- optional per-signer cap
  effective_from    date,
  effective_until   date,
  status            text not null default 'active',  -- 'active' | 'revoked'
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on escrow_authorized_signers(tenant_id, developer_id, status);

-- ============================================================
-- 6) Suppliers — with first-seen tracking for auto-approval after 2nd voucher
-- ============================================================
create table escrow_suppliers (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  name_en             text not null,
  name_ar             text,
  cr_number           text,
  vat_number          text,
  bank_name           text,
  bank_account_number text,
  iban                text,
  contact_email       text,
  contact_phone       text,
  status              escrow_supplier_status not null default 'pending_approval',
  first_seen_at       timestamptz,
  approval_count      int not null default 0,  -- # of vouchers approved against this supplier
  approved_at         timestamptz,
  approved_by_user_id uuid references users(id),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on escrow_suppliers(tenant_id, name_en);
create index on escrow_suppliers(tenant_id, status);

-- ============================================================
-- 7) Supplier contracts — supplier ↔ project ↔ agreed prices (rule #3)
-- ============================================================
create table escrow_contracts (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  project_id      uuid not null references escrow_projects(id) on delete cascade,
  supplier_id     uuid not null references escrow_suppliers(id) on delete restrict,
  contract_number text not null,
  contract_date   date,
  total_value_sar numeric(18,2),
  currency        text not null default 'SAR',
  expense_nature  escrow_account_type not null,  -- which escrow it draws from
  status          text not null default 'active',
  storage_path    text,                      -- PDF of signed contract
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on escrow_contracts(tenant_id, project_id);
create index on escrow_contracts(tenant_id, supplier_id);

-- ============================================================
-- 8) Contract line items — agreed unit prices for matching (rule #3)
-- ============================================================
create table escrow_contract_line_items (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  contract_id       uuid not null references escrow_contracts(id) on delete cascade,
  order_index       int not null,
  item_description  text not null,
  item_description_ar text,
  unit_of_measure   text,
  agreed_unit_price_sar numeric(18,4) not null,
  quantity_estimated  numeric(18,4),
  notes             text,
  created_at        timestamptz not null default now()
);
create index on escrow_contract_line_items(tenant_id, contract_id, order_index);

-- ============================================================
-- 9) Buyers — per project, with their unit-purchase contracts
-- ============================================================
create table escrow_buyers (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  project_id          uuid not null references escrow_projects(id) on delete cascade,
  full_name           text not null,
  national_id_or_iqama text,
  contact_email       text,
  contact_phone       text,
  unit_code           text,                     -- e.g., 'A-203'
  unit_description    text,
  total_unit_price_sar numeric(18,2) not null,
  total_paid_sar      numeric(18,2) not null default 0,
  payment_schedule    jsonb,                    -- array of {due_date, amount, note}
  contract_storage_path text,
  status              text not null default 'active',  -- 'active' | 'cancelled'
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on escrow_buyers(tenant_id, project_id);

-- ============================================================
-- 10) Completion certificates — issued by engineering supervisor (rule #8)
-- ============================================================
create table escrow_completion_certificates (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  project_id        uuid not null references escrow_projects(id) on delete cascade,
  contract_id       uuid references escrow_contracts(id) on delete set null,
  certificate_number text,
  issued_date       date not null,
  completion_pct    numeric(5,2) not null,    -- 0..100
  issued_by_name    text,                     -- engineering supervisor name
  issued_by_title   text,
  storage_path      text,                     -- PDF of the cert
  notes             text,
  created_at        timestamptz not null default now()
);
create index on escrow_completion_certificates(tenant_id, project_id, issued_date desc);

-- ============================================================
-- 11) Invoices — separate from vouchers; rule #9 (no duplicate payment) +
--     rule #10 (developer name on invoice) + rule #12 (supplier ledger)
-- ============================================================
create table escrow_invoices (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  project_id          uuid not null references escrow_projects(id) on delete cascade,
  supplier_id         uuid not null references escrow_suppliers(id) on delete restrict,
  issued_to_developer_id uuid not null references escrow_developers(id) on delete restrict,
  invoice_number      text not null,
  invoice_date        date not null,
  total_sar           numeric(18,2) not null,
  currency            text not null default 'SAR',
  vat_sar             numeric(18,2),
  status              escrow_invoice_status not null default 'open',
  storage_path        text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, supplier_id, invoice_number)
);
create index on escrow_invoices(tenant_id, project_id, status);

-- ============================================================
-- 12) Vouchers — the payment voucher (وثيقة صرف) being audited
-- ============================================================
create table escrow_vouchers (
  id                        uuid primary key default uuid_generate_v4(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  project_id                uuid not null references escrow_projects(id) on delete cascade,
  voucher_number            text not null,           -- doc sequence (rule #1)
  voucher_date              date not null,
  total_sar                 numeric(18,2) not null,
  currency                  text not null default 'SAR',
  beneficiary_supplier_id   uuid references escrow_suppliers(id) on delete restrict,
  source_escrow_account_id  uuid references escrow_accounts(id) on delete restrict,
  expense_nature            escrow_account_type,     -- declared expense type (rule #5)
  signed_by_authorized_signer_id uuid references escrow_authorized_signers(id),
  status                    escrow_voucher_status not null default 'draft',
  submitted_by_user_id      uuid references users(id),
  submitted_by_external_name text,                  -- when uploaded via tokenized link
  submitted_by_external_email text,
  decided_by_user_id        uuid references users(id),
  decided_at                timestamptz,
  decision_reason           text,
  paid_at                   timestamptz,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (tenant_id, project_id, voucher_number)
);
create index on escrow_vouchers(tenant_id, project_id, status);
create index on escrow_vouchers(tenant_id, status, voucher_date desc);

-- ============================================================
-- 13) Voucher↔Invoice link — supports partial payments (rule #9)
--     Sum of allocations across vouchers for one invoice must ≤ invoice.total.
-- ============================================================
create table escrow_voucher_invoice_allocations (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  voucher_id          uuid not null references escrow_vouchers(id) on delete cascade,
  invoice_id          uuid not null references escrow_invoices(id) on delete restrict,
  allocated_amount_sar numeric(18,2) not null,
  created_at          timestamptz not null default now(),
  unique (voucher_id, invoice_id)
);
create index on escrow_voucher_invoice_allocations(tenant_id, invoice_id);

-- ============================================================
-- 14) Voucher uploads — every file attached to a voucher
-- ============================================================
create table escrow_voucher_uploads (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  voucher_id          uuid not null references escrow_vouchers(id) on delete cascade,
  declared_kind       escrow_upload_kind,        -- what the uploader said it is
  classified_kind     escrow_upload_kind,        -- what the agent decided it is
  classification_confidence numeric(3,2),
  filename            text not null,
  display_name        text,
  storage_path        text,
  storage_bucket      text default 'Document submission',
  file_size_bytes     bigint,
  mime_type           text,
  page_count          int,
  uploaded_at         timestamptz not null default now(),
  uploaded_by_user_id uuid references users(id),
  uploaded_by_external_name text,
  uploaded_by_external_email text,
  -- Extracted-by-agent fields (lightweight cache; full evidence in agent_checks)
  extracted_text      text,
  extracted_summary   text,
  notes               text
);
create index on escrow_voucher_uploads(tenant_id, voucher_id, uploaded_at desc);

-- ============================================================
-- 15) Tokenized voucher upload — external developer uploads via magic link
--     (mirror of dms_workflow_signer_tokens for the escrow side)
-- ============================================================
create table escrow_voucher_upload_tokens (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  project_id          uuid not null references escrow_projects(id) on delete cascade,
  voucher_id          uuid references escrow_vouchers(id) on delete set null,  -- nullable: token may pre-date the voucher
  token_hash          text not null unique,
  recipient_name      text not null,
  recipient_email     text not null,
  expires_at          timestamptz not null,
  used_at             timestamptz,
  revoked_at          timestamptz,
  created_by_user_id  uuid references users(id),
  created_at          timestamptz not null default now()
);
create index on escrow_voucher_upload_tokens(tenant_id, project_id);
create index on escrow_voucher_upload_tokens(token_hash);

-- ============================================================
-- 16) Account movements — every debit/credit on every escrow account
-- ============================================================
create table escrow_account_movements (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  escrow_account_id   uuid not null references escrow_accounts(id) on delete cascade,
  kind                escrow_movement_kind not null,
  amount_sar          numeric(18,2) not null,  -- positive for credits, negative for debits
  voucher_id          uuid references escrow_vouchers(id) on delete set null,
  deposit_id          uuid,                    -- FK to escrow_deposits added after that table is defined
  description         text,
  occurred_at         timestamptz not null default now(),
  recorded_by_user_id uuid references users(id),
  notes               text
);
create index on escrow_account_movements(tenant_id, escrow_account_id, occurred_at desc);
create index on escrow_account_movements(tenant_id, voucher_id);

-- ============================================================
-- 17) Bank statements — uploaded by trustee, parsed by agent
-- ============================================================
create table escrow_bank_statements (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  project_id          uuid references escrow_projects(id) on delete set null,
  source_account_iban text,
  period_start        date,
  period_end          date,
  storage_path        text,
  filename            text,
  total_credits_sar   numeric(18,2),
  total_debits_sar    numeric(18,2),
  parsed_at           timestamptz,
  uploaded_by_user_id uuid references users(id),
  uploaded_at         timestamptz not null default now(),
  notes               text
);
create index on escrow_bank_statements(tenant_id, project_id, uploaded_at desc);

-- ============================================================
-- 18) Buyer deposits — extracted from bank statements + auto-allocated 76/20/4
-- ============================================================
create table escrow_deposits (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  project_id          uuid not null references escrow_projects(id) on delete cascade,
  buyer_id            uuid references escrow_buyers(id) on delete set null,
  bank_statement_id   uuid references escrow_bank_statements(id) on delete set null,
  deposit_date        date not null,
  amount_sar          numeric(18,2) not null,
  bank_description    text,                    -- raw description line
  source_account_iban text,
  allocated_construction_sar      numeric(18,2),
  allocated_non_construction_sar  numeric(18,2),
  allocated_preservation_sar      numeric(18,2),
  status              escrow_deposit_status not null default 'parsed',
  match_confidence    numeric(3,2),            -- agent confidence in buyer-match
  posted_at           timestamptz,
  notes               text,
  created_at          timestamptz not null default now()
);
create index on escrow_deposits(tenant_id, project_id, deposit_date desc);
create index on escrow_deposits(tenant_id, buyer_id);

-- Add FK from account_movements.deposit_id now that escrow_deposits exists
alter table escrow_account_movements
  add constraint escrow_account_movements_deposit_id_fkey
  foreign key (deposit_id) references escrow_deposits(id) on delete set null;

-- ============================================================
-- 19) Supplier-ledger imports — for rule #12 (cross-check developer's books)
-- ============================================================
create table escrow_supplier_ledger_imports (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  developer_id        uuid not null references escrow_developers(id) on delete cascade,
  supplier_id         uuid references escrow_suppliers(id) on delete set null,
  period_start        date,
  period_end          date,
  source_filename     text,
  storage_path        text,
  parsed_at           timestamptz,
  uploaded_by_user_id uuid references users(id),
  uploaded_at         timestamptz not null default now()
);
create index on escrow_supplier_ledger_imports(tenant_id, developer_id);

create table escrow_supplier_ledger_entries (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  ledger_import_id    uuid not null references escrow_supplier_ledger_imports(id) on delete cascade,
  supplier_id         uuid references escrow_suppliers(id) on delete set null,
  entry_date          date,
  invoice_number      text,
  description         text,
  debit_sar           numeric(18,2),
  credit_sar          numeric(18,2),
  running_balance_sar numeric(18,2)
);
create index on escrow_supplier_ledger_entries(tenant_id, ledger_import_id);
create index on escrow_supplier_ledger_entries(tenant_id, supplier_id, invoice_number);

-- ============================================================
-- 20) Agent run — one row per audit pass on a voucher
-- ============================================================
create table escrow_voucher_agent_runs (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  voucher_id          uuid not null references escrow_vouchers(id) on delete cascade,
  status              escrow_agent_run_status not null default 'queued',
  invoked_by_user_id  uuid references users(id),
  model               text,                      -- e.g., 'claude-sonnet-4-5-20250929'
  confidence_threshold numeric(3,2) default 0.85,
  auto_advance        boolean not null default false,
  pass_count          int not null default 0,
  fail_count          int not null default 0,
  warn_count          int not null default 0,
  total_tokens_in     int default 0,
  total_tokens_out    int default 0,
  cost_usd            numeric(8,4) default 0,
  started_at          timestamptz,
  completed_at        timestamptz,
  duration_ms         int,
  error_message       text,
  summary             text,                      -- short human-readable conclusion
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on escrow_voucher_agent_runs(tenant_id, voucher_id, started_at desc);
create index on escrow_voucher_agent_runs(tenant_id, status);

-- ============================================================
-- 21) Individual checks within an agent run
-- ============================================================
create table escrow_voucher_agent_checks (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  agent_run_id        uuid not null references escrow_voucher_agent_runs(id) on delete cascade,
  voucher_id          uuid not null references escrow_vouchers(id) on delete cascade,
  order_index         int not null,
  rule_code           text not null,             -- e.g., 'RULE_01_DOC_SEQUENCE'
  rule_title_en       text not null,
  rule_title_ar       text,
  severity            escrow_check_severity not null default 'blocking',
  status              escrow_check_status not null default 'needs_info',
  evidence_quote      text,                      -- the exact text the agent grounded on
  evidence_upload_id  uuid references escrow_voucher_uploads(id) on delete set null,
  related_invoice_id  uuid references escrow_invoices(id) on delete set null,
  related_contract_id uuid references escrow_contracts(id) on delete set null,
  related_signer_id   uuid references escrow_authorized_signers(id) on delete set null,
  expected_value      text,
  actual_value        text,
  ai_confidence       numeric(3,2),
  reasoning           text,                      -- agent's reasoning
  human_override_status escrow_check_status,    -- trustee can override a result
  human_override_note text,
  human_override_by_user_id uuid references users(id),
  human_override_at   timestamptz,
  occurred_at         timestamptz not null default now()
);
create index on escrow_voucher_agent_checks(tenant_id, agent_run_id, order_index);
create index on escrow_voucher_agent_checks(tenant_id, voucher_id, status);

-- ============================================================
-- 22) Triggers — updated_at
-- ============================================================
create trigger trg_escrow_developers_updated_at         before update on escrow_developers         for each row execute function set_updated_at();
create trigger trg_escrow_projects_updated_at           before update on escrow_projects           for each row execute function set_updated_at();
create trigger trg_escrow_accounts_updated_at           before update on escrow_accounts           for each row execute function set_updated_at();
create trigger trg_escrow_authorized_signers_updated_at before update on escrow_authorized_signers for each row execute function set_updated_at();
create trigger trg_escrow_suppliers_updated_at          before update on escrow_suppliers          for each row execute function set_updated_at();
create trigger trg_escrow_contracts_updated_at          before update on escrow_contracts          for each row execute function set_updated_at();
create trigger trg_escrow_buyers_updated_at             before update on escrow_buyers             for each row execute function set_updated_at();
create trigger trg_escrow_invoices_updated_at           before update on escrow_invoices           for each row execute function set_updated_at();
create trigger trg_escrow_vouchers_updated_at           before update on escrow_vouchers           for each row execute function set_updated_at();
create trigger trg_escrow_voucher_agent_runs_updated_at before update on escrow_voucher_agent_runs for each row execute function set_updated_at();

-- ============================================================
-- 23) RLS — tenant isolation per existing pattern
-- ============================================================
alter table escrow_developers                       enable row level security;
alter table escrow_projects                         enable row level security;
alter table escrow_accounts                         enable row level security;
alter table escrow_authorized_signers               enable row level security;
alter table escrow_suppliers                        enable row level security;
alter table escrow_contracts                        enable row level security;
alter table escrow_contract_line_items              enable row level security;
alter table escrow_buyers                           enable row level security;
alter table escrow_completion_certificates          enable row level security;
alter table escrow_invoices                         enable row level security;
alter table escrow_vouchers                         enable row level security;
alter table escrow_voucher_invoice_allocations      enable row level security;
alter table escrow_voucher_uploads                  enable row level security;
alter table escrow_voucher_upload_tokens            enable row level security;
alter table escrow_account_movements                enable row level security;
alter table escrow_bank_statements                  enable row level security;
alter table escrow_deposits                         enable row level security;
alter table escrow_supplier_ledger_imports          enable row level security;
alter table escrow_supplier_ledger_entries          enable row level security;
alter table escrow_voucher_agent_runs               enable row level security;
alter table escrow_voucher_agent_checks             enable row level security;

create policy esc_dev_sel  on escrow_developers                  for select using (tenant_id = auth_tenant_id());
create policy esc_dev_mod  on escrow_developers                  for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_proj_sel on escrow_projects                    for select using (tenant_id = auth_tenant_id());
create policy esc_proj_mod on escrow_projects                    for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_acct_sel on escrow_accounts                    for select using (tenant_id = auth_tenant_id());
create policy esc_acct_mod on escrow_accounts                    for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_sgn_sel  on escrow_authorized_signers          for select using (tenant_id = auth_tenant_id());
create policy esc_sgn_mod  on escrow_authorized_signers          for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_sup_sel  on escrow_suppliers                   for select using (tenant_id = auth_tenant_id());
create policy esc_sup_mod  on escrow_suppliers                   for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_ctr_sel  on escrow_contracts                   for select using (tenant_id = auth_tenant_id());
create policy esc_ctr_mod  on escrow_contracts                   for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_cli_sel  on escrow_contract_line_items         for select using (tenant_id = auth_tenant_id());
create policy esc_cli_mod  on escrow_contract_line_items         for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_buy_sel  on escrow_buyers                      for select using (tenant_id = auth_tenant_id());
create policy esc_buy_mod  on escrow_buyers                      for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_cer_sel  on escrow_completion_certificates     for select using (tenant_id = auth_tenant_id());
create policy esc_cer_mod  on escrow_completion_certificates     for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_inv_sel  on escrow_invoices                    for select using (tenant_id = auth_tenant_id());
create policy esc_inv_mod  on escrow_invoices                    for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_vch_sel  on escrow_vouchers                    for select using (tenant_id = auth_tenant_id());
create policy esc_vch_mod  on escrow_vouchers                    for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_via_sel  on escrow_voucher_invoice_allocations for select using (tenant_id = auth_tenant_id());
create policy esc_via_mod  on escrow_voucher_invoice_allocations for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_vup_sel  on escrow_voucher_uploads             for select using (tenant_id = auth_tenant_id());
create policy esc_vup_mod  on escrow_voucher_uploads             for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_vtk_sel  on escrow_voucher_upload_tokens       for select using (tenant_id = auth_tenant_id());
create policy esc_vtk_mod  on escrow_voucher_upload_tokens       for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_mov_sel  on escrow_account_movements           for select using (tenant_id = auth_tenant_id());
create policy esc_mov_mod  on escrow_account_movements           for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_bst_sel  on escrow_bank_statements             for select using (tenant_id = auth_tenant_id());
create policy esc_bst_mod  on escrow_bank_statements             for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_dep_sel  on escrow_deposits                    for select using (tenant_id = auth_tenant_id());
create policy esc_dep_mod  on escrow_deposits                    for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_sli_sel  on escrow_supplier_ledger_imports     for select using (tenant_id = auth_tenant_id());
create policy esc_sli_mod  on escrow_supplier_ledger_imports     for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_sle_sel  on escrow_supplier_ledger_entries     for select using (tenant_id = auth_tenant_id());
create policy esc_sle_mod  on escrow_supplier_ledger_entries     for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_arn_sel  on escrow_voucher_agent_runs          for select using (tenant_id = auth_tenant_id());
create policy esc_arn_mod  on escrow_voucher_agent_runs          for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy esc_ack_sel  on escrow_voucher_agent_checks        for select using (tenant_id = auth_tenant_id());
create policy esc_ack_mod  on escrow_voucher_agent_checks        for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

-- ============================================================
-- 24) Helper view — per-invoice payment summary (for rule #9 duplicate check)
-- ============================================================
create or replace view v_escrow_invoice_payments as
select
  i.id                                          as invoice_id,
  i.tenant_id,
  i.project_id,
  i.supplier_id,
  i.invoice_number,
  i.total_sar                                   as invoice_total_sar,
  coalesce(sum(a.allocated_amount_sar), 0)      as paid_sar,
  greatest(i.total_sar - coalesce(sum(a.allocated_amount_sar), 0), 0) as remaining_sar,
  count(a.id)                                   as payment_count
from escrow_invoices i
left join escrow_voucher_invoice_allocations a on a.invoice_id = i.id
group by i.id, i.tenant_id, i.project_id, i.supplier_id, i.invoice_number, i.total_sar;

-- ============================================================
-- 25) Helper view — per-project escrow balances + receivables snapshot
-- ============================================================
create or replace view v_escrow_project_summary as
select
  p.id          as project_id,
  p.tenant_id,
  p.code,
  p.name_en,
  p.name_ar,
  p.developer_id,
  coalesce(sum(a.current_balance_sar) filter (where a.account_type = 'construction'),     0) as balance_construction_sar,
  coalesce(sum(a.current_balance_sar) filter (where a.account_type = 'non_construction'), 0) as balance_non_construction_sar,
  coalesce(sum(a.current_balance_sar) filter (where a.account_type = 'preservation'),     0) as balance_preservation_sar,
  coalesce(sum(a.current_balance_sar), 0) as balance_total_sar
from escrow_projects p
left join escrow_accounts a on a.project_id = p.id
group by p.id, p.tenant_id, p.code, p.name_en, p.name_ar, p.developer_id;

-- ============================================================
-- 26) POST-MIGRATION MANUAL STEP — Storage bucket (reuses 'Document submission')
-- ============================================================
-- The escrow module reuses the existing 'Document submission' Supabase Storage
-- bucket that was set up for the DMS module (see migration 025, section 8).
-- No new bucket is required. Voucher uploads live under a path prefix of
-- `escrow/{tenant_id}/{project_id}/{voucher_id}/` for clean isolation.
