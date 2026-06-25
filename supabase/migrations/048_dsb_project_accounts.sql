-- 048_dsb_project_accounts.sql
-- ----------------------------------------------------------------------------
-- Per-project payment accounts. Each project owns a list of accounts
-- (bank accounts the disbursements come out of); a delivered case records
-- which account the payment went out of.
--
-- Why a separate table (vs. the single bank fields on dsb_projects added
-- in 040)? A project typically has one escrow but in practice a developer
-- runs several operating accounts per project. The single-row fields stay
-- in place as a "primary" account for legacy display; this table is the
-- source of truth for the picker shown when editing a delivered case.
--
-- Owner-only writes are enforced at the action layer.
-- ----------------------------------------------------------------------------

create table if not exists dsb_project_accounts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  project_id          uuid not null references dsb_projects(id) on delete cascade,
  label               text not null,
  account_number      text,
  bank_name           text,
  iban                text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by_user_id  uuid
);

create index if not exists dsb_project_accounts_project_idx
  on dsb_project_accounts (project_id, is_active, label);

-- Link each case to the account the payment came from. ON DELETE SET NULL
-- so a deleted account just removes the back-reference; the historical
-- delivery record itself stays intact.
alter table dsb_cases
  add column if not exists paid_from_account_id uuid
  references dsb_project_accounts(id) on delete set null;

create index if not exists dsb_cases_paid_from_idx
  on dsb_cases (paid_from_account_id);
