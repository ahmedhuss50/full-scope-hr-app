-- 002_core_multitenancy.sql
-- Core tenancy, users, roles, firm_settings.

create table tenants (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  slug            text not null unique,
  subdomain       text not null unique,
  locale_default  text not null default 'en',          -- 'en' | 'ar'
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Renamed from Innuvis 'tenant_settings' -> 'firm_settings' to match Full Scope HR accounting-firm domain.
create table firm_settings (
  tenant_id              uuid primary key references tenants(id) on delete cascade,
  brand_primary_hex      text default '2E75B6',
  brand_logo_url         text,
  support_email          text,
  support_phone          text,
  enable_sms             boolean not null default true,
  enable_whatsapp        boolean not null default true,    -- WhatsApp Business common in GCC
  enable_qbo             boolean not null default true,
  enable_xero            boolean not null default true,
  enable_sage            boolean not null default false,
  default_locale         text not null default 'en',       -- 'en' | 'ar'
  fiscal_year_start_month int not null default 1,
  default_currency       text not null default 'AED',      -- AED, SAR, KWD, QAR, BHD, OMR, USD, EUR
  vat_pct                numeric(5,2) not null default 5.0,
  gcc_country_code       text not null default 'AE',       -- AE, SA, KW, QA, BH, OM
  config                 jsonb not null default '{}'::jsonb,
  updated_at             timestamptz not null default now()
);

create table roles (
  key           text primary key,
  label_en      text not null,
  label_ar      text not null,
  description   text,
  permissions   jsonb not null default '[]'::jsonb
);

-- Seed the canonical roles (label_ar replaces Innuvis label_es)
insert into roles(key, label_en, label_ar, description, permissions) values
  ('admin',             'Admin',              'مسؤول',                'Full access including settings', '["*"]'::jsonb),
  ('hr',                'HR',                 'الموارد البشرية',       'Manage candidates, employees, docs', '["candidates:*","applications:*","interviews:*","employees:*","vendors:*","documents:*","payroll:sync"]'::jsonb),
  ('practice_manager',  'Practice Manager',   'مدير الممارسة',         'Practice-area lead reviewing candidates and interviews', '["applications:read","applications:update","interviews:*","employees:read"]'::jsonb),
  ('hiring_manager',    'Hiring Manager',     'مدير التوظيف',          'Review candidates, decide interviews', '["applications:read","applications:update","interviews:*"]'::jsonb),
  ('managing_partner',  'Managing Partner',   'الشريك الإداري',        'Firm-level oversight; sees all areas', '["*:read","applications:update","interviews:*","employees:*"]'::jsonb),
  ('viewer',            'Viewer',             'مراقب',                 'Read-only across the tenant', '["*:read"]'::jsonb),
  ('candidate_portal',  'Candidate',          'مرشح',                  'Candidate self-service portal', '["self:read","self:update"]'::jsonb);

create table users (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  email           text not null,
  full_name       text not null,
  phone           text,
  locale          text not null default 'en',     -- 'en' | 'ar'
  active          boolean not null default true,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, email)
);

create table user_roles (
  user_id     uuid not null references users(id) on delete cascade,
  role_key    text not null references roles(key) on delete restrict,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references users(id),
  primary key (user_id, role_key)
);

create trigger trg_tenants_updated_at        before update on tenants        for each row execute function set_updated_at();
create trigger trg_firm_settings_updated_at  before update on firm_settings  for each row execute function set_updated_at();
create trigger trg_users_updated_at          before update on users          for each row execute function set_updated_at();
