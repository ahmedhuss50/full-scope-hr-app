-- 007_compliance_documents.sql
-- Document signing (Documenso pointers) + GCC-adapted compliance artifacts.
-- US-specific tables (i9_records, everify_cases, w4_elections, state_tax_elections,
-- eeo_self_id) intentionally REMOVED for Full Scope HR; replaced by gcc_compliance_records.

create type document_kind_enum as enum (
  'offer_letter','nda','handbook_ack','ic_agreement','engagement_letter',
  'labor_contract','non_compete','code_of_conduct','custom'
);

create type document_status_enum as enum (
  'draft','sent','viewed','signed','declined','expired','voided'
);

create table document_templates (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  kind                 document_kind_enum not null,
  locale               text not null default 'en',          -- 'en' | 'ar'
  documenso_template_id text,
  label                text not null,
  version              int not null default 1,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, kind, locale, version)
);

create table documents (
  id                     uuid primary key default uuid_generate_v4(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  template_id            uuid references document_templates(id),
  employee_id            uuid references employees(id) on delete set null,
  vendor_id              uuid references vendors(id) on delete set null,
  candidate_id           uuid references candidates(id) on delete set null,
  kind                   document_kind_enum not null,
  locale                 text not null default 'en',
  documenso_envelope_id  text,
  status                 document_status_enum not null default 'draft',
  sent_at                timestamptz,
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table document_signatures (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  document_id     uuid not null references documents(id) on delete cascade,
  signer_email    text not null,
  signer_name     text,
  status          document_status_enum not null default 'sent',
  signed_at       timestamptz,
  created_at      timestamptz not null default now()
);

-- GCC-specific compliance: residency, visa, labor contract artifacts.
-- Replaces Innuvis i9_records + everify_cases + state_tax_elections + w4_elections.
create type gcc_doc_kind_enum as enum (
  'emirates_id','iqama','national_id','passport','residency_visa',
  'labor_contract','work_permit','wps_enrollment','health_card','other'
);

create type gcc_doc_status_enum as enum (
  'pending','submitted','verified','expired','rejected'
);

create table gcc_compliance_records (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  employee_id         uuid references employees(id) on delete cascade,
  vendor_id           uuid references vendors(id) on delete cascade,
  document_kind       gcc_doc_kind_enum not null,
  document_ref        text,                                -- external system ref (MOHRE, GDRFA, GOSI, etc.)
  document_number_encrypted bytea,
  issuing_country     text references gcc_countries(code),
  issued_on           date,
  expires_on          date,
  status              gcc_doc_status_enum not null default 'pending',
  verified_at         timestamptz,
  verified_by_user_id uuid references users(id),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint gcc_compliance_owner_present check (
    employee_id is not null or vendor_id is not null
  )
);

create type check_status_enum as enum ('ordered','pending','clear','review','adverse','cancelled');

create table background_checks (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  provider      text not null,                              -- e.g., 'Checkr','HireRight','Sterling','TruScreen'
  provider_ref  text,
  status        check_status_enum not null default 'ordered',
  ordered_at    timestamptz not null default now(),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create type drug_test_result_enum as enum ('pending','passed','failed','mro_review','cancelled');

create table drug_tests (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  provider      text not null,
  provider_ref  text,
  result        drug_test_result_enum not null default 'pending',
  ordered_at    timestamptz not null default now(),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create type bank_account_type_enum as enum ('Checking','Savings','Current');

create table direct_deposit_accounts (
  id                          uuid primary key default uuid_generate_v4(),
  tenant_id                   uuid not null references tenants(id) on delete cascade,
  employee_id                 uuid references employees(id) on delete cascade,
  vendor_id                   uuid references vendors(id) on delete cascade,
  account_type                bank_account_type_enum not null,
  bank_name                   text,
  iban_encrypted              bytea,                       -- IBAN required for GCC bank transfers
  swift_bic                   text,
  routing_number_encrypted    bytea,                       -- US ABA routing (optional)
  account_number_encrypted    bytea not null,
  account_currency            text default 'AED',
  split_pct                   numeric(5,2) not null default 100.00 check (split_pct > 0 and split_pct <= 100),
  order_index                 int not null default 1,
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint dd_owner_present check (employee_id is not null or vendor_id is not null)
);

create trigger trg_document_templates_updated_at      before update on document_templates      for each row execute function set_updated_at();
create trigger trg_documents_updated_at               before update on documents               for each row execute function set_updated_at();
create trigger trg_gcc_compliance_records_updated_at  before update on gcc_compliance_records  for each row execute function set_updated_at();
create trigger trg_background_checks_updated_at       before update on background_checks       for each row execute function set_updated_at();
create trigger trg_drug_tests_updated_at              before update on drug_tests              for each row execute function set_updated_at();
create trigger trg_direct_deposit_accounts_updated_at before update on direct_deposit_accounts for each row execute function set_updated_at();
