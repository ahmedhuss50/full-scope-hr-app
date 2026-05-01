-- 003_reference_data.sql
-- Global reference data + per-tenant lookups (departments, locations, job reqs, practice areas).

-- Global (no tenant_id) — readable by all authenticated users.
-- GCC + key EN markets the platform serves at launch.
create table gcc_countries (
  code            text primary key,           -- ISO-2 (AE, SA, KW, QA, BH, OM, US, GB, etc.)
  name_en         text not null,
  name_ar         text,
  currency        text not null,              -- AED, SAR, KWD, QAR, BHD, OMR, USD, GBP
  vat_default_pct numeric(5,2) not null default 0,
  is_gcc          boolean not null default false
);

insert into gcc_countries(code, name_en, name_ar, currency, vat_default_pct, is_gcc) values
  ('AE','United Arab Emirates','الإمارات العربية المتحدة','AED', 5.0,  true),
  ('SA','Saudi Arabia',        'المملكة العربية السعودية','SAR', 15.0, true),
  ('KW','Kuwait',               'الكويت',                  'KWD', 0.0,  true),
  ('QA','Qatar',                'قطر',                     'QAR', 0.0,  true),
  ('BH','Bahrain',              'البحرين',                 'BHD', 10.0, true),
  ('OM','Oman',                 'عُمان',                   'OMR', 5.0,  true),
  ('US','United States',        null,                      'USD', 0.0,  false),
  ('GB','United Kingdom',       null,                      'GBP', 20.0, false),
  ('IN','India',                null,                      'INR', 18.0, false),
  ('PK','Pakistan',             null,                      'PKR', 17.0, false),
  ('EG','Egypt',                'مصر',                     'EGP', 14.0, false),
  ('JO','Jordan',               'الأردن',                  'JOD', 16.0, false);

-- Per-tenant lookups
create table departments (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table work_locations (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,
  address_line_1  text,
  address_line_2  text,
  city            text,
  emirate_or_region text,                                -- e.g., 'Dubai', 'Riyadh', 'Doha'
  country_code    text references gcc_countries(code),
  postal_code     text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, name)
);

-- Replaces Innuvis 'wc_classes' (workers' comp). Full Scope HR uses practice areas
-- (audit/tax/advisory/BD/admin) to drive role taxonomy across the firm.
create table practice_areas (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  code        text not null,                  -- 'audit','tax','advisory','bd','admin'
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

create type job_requisition_status as enum ('open','on_hold','filled','closed');
create type pay_type_enum          as enum ('Hourly','Salary','Commission','Retainer');
-- Classification stays W-2/1099 — accounting firms in GCC frequently engage
-- 1099-style independent contractors (esp. for advisory + BD outreach).
create type classification_enum    as enum ('W-2','1099');

create table job_requisitions (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  title             text not null,
  description       text,
  department_id     uuid references departments(id),
  practice_area_id  uuid references practice_areas(id),
  work_location_id  uuid references work_locations(id),
  pay_type          pay_type_enum,
  pay_rate_min      numeric(12,2),
  pay_rate_max      numeric(12,2),
  pay_currency      text default 'AED',
  classification    classification_enum not null default 'W-2',
  status            job_requisition_status not null default 'open',
  openings_count    int not null default 1,
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  created_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_departments_updated_at       before update on departments       for each row execute function set_updated_at();
create trigger trg_work_locations_updated_at    before update on work_locations    for each row execute function set_updated_at();
create trigger trg_practice_areas_updated_at    before update on practice_areas    for each row execute function set_updated_at();
create trigger trg_job_requisitions_updated_at  before update on job_requisitions  for each row execute function set_updated_at();
