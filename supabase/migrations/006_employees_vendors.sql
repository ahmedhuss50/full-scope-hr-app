-- 006_employees_vendors.sql
-- Post-hire tables: employees (W-2), vendors (1099), and the hire_events ledger
-- that links candidates to their post-hire record.
-- Includes light "cert preview" columns per DEC-003; the full O2 employee_credentials
-- table arrives in Phase 3 (stub created in 010_system_logs.sql).

create type employment_type_enum as enum ('Full-time','Part-time','Seasonal','Temp','Secondment');
create type flsa_status_enum     as enum ('Exempt','Non-exempt');
create type pay_frequency_enum   as enum ('Weekly','Biweekly','Semimonthly','Monthly');
create type pay_method_enum      as enum ('Direct Deposit','Cheque','Wire','Cash');
create type vendor_structure_enum as enum ('Sole Proprietor','LLC','S-Corp','C-Corp','Partnership','Free Zone Establishment','LLC-FZ','Branch');

create table employees (
  id                                  uuid primary key default uuid_generate_v4(),
  tenant_id                           uuid not null references tenants(id) on delete cascade,
  origin_candidate_id                 uuid references candidates(id),
  legal_first_name                    text not null,
  legal_middle_name                   text,
  legal_last_name                     text not null,
  name_suffix                         text,
  preferred_name                      text,
  primary_email                       text,
  mobile_phone                        text,
  alternate_phone                     text,
  date_of_birth                       date,
  national_id_encrypted               bytea,                              -- Emirates ID / Iqama / NIN (replaces ssn for GCC)
  passport_number_encrypted           bytea,
  gender                              text,
  home_address                        jsonb not null,                     -- {street_1, street_2, city, region, country_code, postal_code}
  mailing_address                     jsonb,
  employment_type                     employment_type_enum,
  flsa_status                         flsa_status_enum,
  pay_type                            pay_type_enum not null,
  pay_rate_encrypted                  bytea,
  pay_currency                        text default 'AED',
  pay_frequency                       pay_frequency_enum,
  pay_method                          pay_method_enum not null default 'Direct Deposit',
  hire_date                           date,
  department_id                       uuid references departments(id),
  practice_area_id                    uuid references practice_areas(id),
  job_title                           text not null,
  direct_supervisor_id                uuid references users(id),
  work_location_id                    uuid references work_locations(id),

  -- Cert preview columns (DEC-003) — full schema in Phase 3 employee_credentials (O2)
  primary_license                     text,                               -- 'CPA','CFA','EA','ACCA','CIA','SOCPA','None'
  primary_license_number_encrypted    bytea,
  primary_license_jurisdiction        text,                               -- 'UAE','KSA','US-CA','US-NY','UK', etc.
  primary_license_expires_on          date,
  cert_status                         text,                               -- 'active','expiring_soon','expired','none'

  active                              boolean not null default true,
  termination_date                    date,
  termination_reason                  text,
  rehire_eligible                     boolean,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now()
);

create table vendors (
  id                                  uuid primary key default uuid_generate_v4(),
  tenant_id                           uuid not null references tenants(id) on delete cascade,
  origin_candidate_id                 uuid references candidates(id),
  legal_first_name                    text not null,
  legal_last_name                     text not null,
  business_name                       text,
  structure                           vendor_structure_enum not null,
  national_id_encrypted               bytea,
  trade_license_number_encrypted      bytea,                              -- TRN/CR/Trade License (replaces EIN for GCC)
  primary_email                       text,
  mobile_phone                        text,
  home_address                        jsonb not null,
  pay_type                            pay_type_enum not null,
  pay_rate_encrypted                  bytea,
  pay_currency                        text default 'AED',
  engagement_start_date               date,
  engagement_end_date                 date,
  w9_or_equivalent_on_file            boolean not null default false,     -- W-9 (US) or trade-license-on-file (GCC)
  w9_or_equivalent_signed_date        date,
  vendor_1099_eligible                boolean not null default true,
  ic_agreement_signed                 boolean not null default false,

  -- Cert preview (firm engages contractor CPAs/EAs/CFAs)
  primary_license                     text,
  primary_license_number_encrypted    bytea,
  primary_license_jurisdiction        text,
  primary_license_expires_on          date,
  cert_status                         text,

  active                              boolean not null default true,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  constraint vendor_tax_id_present check (national_id_encrypted is not null or trade_license_number_encrypted is not null)
);

create table hire_events (
  id                    uuid primary key default uuid_generate_v4(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  candidate_id          uuid not null references candidates(id),
  classification        classification_enum not null,
  target_employee_id    uuid references employees(id),
  target_vendor_id      uuid references vendors(id),
  application_id        uuid references applications(id),
  interview_decision_id uuid references interview_decisions(id),
  decided_by_user_id    uuid references users(id),
  hired_at              timestamptz not null default now(),
  constraint hire_event_target_exclusive check (
    (target_employee_id is not null and target_vendor_id is null) or
    (target_employee_id is null and target_vendor_id is not null)
  )
);

create table employee_pay_rate_history (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  employee_id          uuid not null references employees(id) on delete cascade,
  pay_rate_encrypted   bytea not null,
  pay_currency         text,
  effective_reason     text,
  effective_date       date not null,
  entered_by_user_id   uuid references users(id),
  recorded_at          timestamptz not null default now()
);

create table classification_changes (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  candidate_id         uuid references candidates(id),
  from_employee_id     uuid references employees(id),
  from_vendor_id       uuid references vendors(id),
  to_employee_id       uuid references employees(id),
  to_vendor_id         uuid references vendors(id),
  from_classification  classification_enum,
  to_classification    classification_enum not null,
  changed_by_user_id   uuid references users(id),
  reason               text,
  at                   timestamptz not null default now()
);

create table emergency_contacts (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  employee_id  uuid references employees(id) on delete cascade,
  vendor_id    uuid references vendors(id) on delete cascade,
  name         text not null,
  phone        text not null,
  relationship text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint emergency_contact_owner_present check (
    employee_id is not null or vendor_id is not null
  )
);

create trigger trg_employees_updated_at          before update on employees          for each row execute function set_updated_at();
create trigger trg_vendors_updated_at            before update on vendors            for each row execute function set_updated_at();
create trigger trg_emergency_contacts_updated_at before update on emergency_contacts for each row execute function set_updated_at();
