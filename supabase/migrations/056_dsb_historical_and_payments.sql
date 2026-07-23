-- 056_dsb_historical_and_payments.sql
-- ----------------------------------------------------------------------------
-- Historical data migration support:
--
--   1) Flag rows on dsb_cases that were bulk-imported from legacy archives
--      (past voucher/disbursement records) so we can tell them apart from
--      cases that went through the actual review workflow. Also add a
--      nullable unit_id link so a historical case can point to the unit it
--      was disbursed against.
--
--   2) A brand-new dsb_payments ledger — standalone transactions independent
--      of the case workflow. Each row can optionally link downward to a
--      project / account / case / unit; all four are ON DELETE SET NULL so
--      the ledger row survives deletions of the referenced entity.
--
-- Additive + idempotent. Safe to run against a live DB.
-- ----------------------------------------------------------------------------

-- 1) Flags + optional unit link on dsb_cases.
alter table dsb_cases
  add column if not exists is_historical boolean not null default false,
  add column if not exists historical_source_note text,
  add column if not exists unit_id uuid references dsb_project_units(id) on delete set null;

-- Partial index — historical rows are a tiny fraction of total cases so we
-- only index the true half. Query pattern is
--   WHERE tenant_id = ? AND is_historical = true.
create index if not exists dsb_cases_historical_idx
  on dsb_cases (tenant_id, is_historical) where is_historical = true;

-- Support "give me historical cases for this unit" without a full scan.
create index if not exists dsb_cases_unit_idx
  on dsb_cases (unit_id) where unit_id is not null;

-- 2) Payments ledger — standalone transactions.
create table if not exists dsb_payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  project_id          uuid references dsb_projects(id) on delete set null,
  account_id          uuid references dsb_project_accounts(id) on delete set null,
  case_id             uuid references dsb_cases(id) on delete set null,
  unit_id             uuid references dsb_project_units(id) on delete set null,
  payment_date        date not null,
  amount_sar          numeric not null,
  vat_sar             numeric,
  currency            text not null default 'SAR',
  beneficiary_name    text,
  description         text,
  reference_number    text,          -- external ref / SWIFT / bank ref
  payment_method      text,          -- 'bank_transfer' | 'check' | 'cash' | 'other' — free text
  notes               text,
  imported_from       text,          -- 'ledger_import' | 'case_workflow' | manual
  created_at          timestamptz not null default now(),
  created_by_user_id  uuid
);

-- Primary browse index: tenant → project → most-recent-first.
create index if not exists dsb_payments_tenant_project_idx
  on dsb_payments (tenant_id, project_id, payment_date desc);

-- Secondary lookups — partial indexes since these FKs are optional.
create index if not exists dsb_payments_account_idx
  on dsb_payments (account_id) where account_id is not null;
create index if not exists dsb_payments_case_idx
  on dsb_payments (case_id) where case_id is not null;
create index if not exists dsb_payments_unit_idx
  on dsb_payments (unit_id) where unit_id is not null;
