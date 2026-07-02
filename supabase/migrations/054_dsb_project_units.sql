-- 054_dsb_project_units.sql
-- ============================================================================
-- UNITS + BUYERS + CONTRACTS — real-estate unit master + sale history
-- ============================================================================
-- Each project (dsb_projects) can now list its real-estate units. Each unit
-- has a sale history (resells append rows). Contract PDFs are uploaded and
-- linked to a specific sale after Claude Vision extracts identifying fields.
--
-- Import flow (owner-only):
--   Excel master list (per project) → dsb_project_units + dsb_unit_sales rows
--
-- Contract flow:
--   PDF uploaded → dsb_unit_contracts (extraction_status='pending')
--   → /api/dsb-contract-extract runs Claude Vision → status='matched'|'no_match'
--
-- RUN ORDER: depends on 030 (dsb_projects), 002 (tenants + users).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Unit master — immutable specs about a physical unit
-- ---------------------------------------------------------------------------
create table if not exists dsb_project_units (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  project_id        uuid not null references dsb_projects(id) on delete cascade,
  unit_number       text not null,
  zone_number       text,
  block_number      text,
  unit_type         text,   -- villa | apartment | other
  area_m2           numeric,
  district          text,
  city              text,
  region            text,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (project_id, unit_number)
);
create index if not exists dsb_project_units_project_idx on dsb_project_units (project_id);

-- ---------------------------------------------------------------------------
-- 2) Sales — one row per sale of a unit (resells add rows, not replace)
-- ---------------------------------------------------------------------------
create table if not exists dsb_unit_sales (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null,
  unit_id                uuid not null references dsb_project_units(id) on delete cascade,
  sale_count             int not null default 1,
  sale_status            text not null default 'active',
    -- 'active' | 'cancelled' | 'cancelled_resold' | 'completed'
  buyer_name_ar          text,
  buyer_id_type          text,   -- national | residency | passport
  buyer_id_number        text,
  buyer_nationality      text,
  buyer_residency_type   text,
  buyer_phone            text,
  contract_number        text,
  contract_type          text,
  financing_type         text,
  financing_bank         text,
  sale_date              date,
  price_before_tax_sar   numeric,
  vat_sar                numeric,
  price_with_vat_sar     numeric,
  delivery_status        text,
  delivery_date          date,
  created_at             timestamptz not null default now()
);
create index if not exists dsb_unit_sales_unit_idx on dsb_unit_sales (unit_id, sale_count desc);
create index if not exists dsb_unit_sales_contract_idx on dsb_unit_sales (tenant_id, contract_number)
  where contract_number is not null;

-- ---------------------------------------------------------------------------
-- 3) Uploaded contract PDFs — one contract may link to one sale
-- ---------------------------------------------------------------------------
create table if not exists dsb_unit_contracts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  sale_id               uuid references dsb_unit_sales(id) on delete set null,
  unit_id               uuid references dsb_project_units(id) on delete set null,
  uploaded_by_user_id   uuid,
  storage_path          text not null,
  storage_bucket        text not null default 'Document submission',
  filename              text,
  file_size_bytes       int,
  extraction_status     text not null default 'pending',
    -- 'pending' | 'matched' | 'no_match' | 'failed'
  extracted_fields      jsonb,
  extracted_at          timestamptz,
  extraction_cost_usd   numeric,
  extraction_model      text,
  matched_confidence    numeric,   -- 0..1
  uploaded_at           timestamptz not null default now()
);
create index if not exists dsb_unit_contracts_sale_idx on dsb_unit_contracts (sale_id);
create index if not exists dsb_unit_contracts_unit_idx on dsb_unit_contracts (unit_id);
create index if not exists dsb_unit_contracts_pending_idx on dsb_unit_contracts (tenant_id, extraction_status)
  where extraction_status = 'pending';
