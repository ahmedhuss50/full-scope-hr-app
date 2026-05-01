-- 004_candidates_applications.sql
-- Candidate and application records (pre-hire). Adapted to accounting/BD-firm domain
-- with CPA/EA/CFA cert-track signals captured at the candidate stage.

create type work_auth_status_enum as enum (
  'GCC National',
  'GCC Resident',
  'Permanent Resident',
  'Work Visa Sponsored',
  'Citizen of Hiring Country',
  'Requires Sponsorship'
);

create type application_status_enum as enum (
  'applied',
  'in_review',
  'interview_pending',
  'interview_scheduled',
  'interview_completed',
  'decision_pending',
  'offer_extended',
  'offer_accepted',
  'hired',
  'rejected',
  'withdrawn'
);

create type application_source_enum as enum (
  'walk_in', 'referral', 'linkedin', 'indeed', 'bayt', 'naukrigulf', 'website', 'whatsapp', 'other'
);

create table candidates (
  id                        uuid primary key default uuid_generate_v4(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  legal_first_name          text not null,
  legal_middle_name         text,
  legal_last_name           text not null,
  preferred_name            text,
  primary_email             text,
  mobile_phone              text,
  alternate_phone           text,
  home_country_code         text references gcc_countries(code),
  home_city                 text,
  home_postal_code          text,
  work_auth_status          work_auth_status_enum,
  classification_preference classification_enum,
  source                    application_source_enum,
  referring_user_id         uuid references users(id),
  recruiting_campaign       text,
  locale                    text not null default 'en',  -- 'en' | 'ar'

  -- Accounting-firm specific qualification fields (Full Scope HR delta from Innuvis)
  cpa_track                 boolean not null default false,
  licenses_held             text[],                       -- e.g., {CPA, CFA, EA, ACCA, CIA}
  jurisdictions             text[],                       -- e.g., {UAE, KSA, US-CA, UK}
  years_experience          int,
  audit_hours               int,                          -- accumulated audit-attest hours
  primary_practice_area     text,                         -- audit | tax | advisory | bd | admin

  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table applications (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  candidate_id         uuid not null references candidates(id) on delete cascade,
  job_requisition_id   uuid references job_requisitions(id),
  resume_file_ref      text,
  answers              jsonb not null default '{}'::jsonb,
  status               application_status_enum not null default 'applied',
  applied_at           timestamptz not null default now(),
  closed_at            timestamptz,
  close_reason         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, candidate_id, job_requisition_id)
);

create table application_status_history (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references applications(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  from_status     application_status_enum,
  to_status       application_status_enum not null,
  actor_user_id   uuid references users(id),
  reason_code     text,
  notes           text,
  at              timestamptz not null default now()
);

create trigger trg_candidates_updated_at     before update on candidates     for each row execute function set_updated_at();
create trigger trg_applications_updated_at   before update on applications   for each row execute function set_updated_at();
