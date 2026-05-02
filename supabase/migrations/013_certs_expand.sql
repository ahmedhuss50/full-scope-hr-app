-- 013_certs_expand.sql
-- Phase 3 / Block O — expand the stub employee_credentials and firm_credentials
-- tables (created in 010_system_logs.sql) into the real cert-tracking schema.
--
-- Strategy: ALTER existing tables (don't drop) so any seeded rows + RLS policies
-- + updated_at triggers from 010 are preserved.
--
-- Also introduces cert_status_enum, replacing the free-text `status` column.

-- ============================================================
-- Enum: cert lifecycle status
-- ============================================================
create type cert_status_enum as enum (
  'active',
  'expiring_soon',
  'expired',
  'renewed',
  'revoked',
  'pending_verification'
);

-- ============================================================
-- employee_credentials — expand stub
-- ============================================================
alter table employee_credentials
  add column credential_number_encrypted   bytea,
  add column issuing_authority             text,
  add column jurisdiction                  text,
  add column issued_on                     date,
  add column expires_on                    date,
  add column renewal_window_starts_on      date,
  add column evidence_url                  text,
  add column notes                         text,
  add column holder_role                   text;

-- Replace text status with enum. Drop old default, swap type, install new default.
alter table employee_credentials alter column status drop default;
alter table employee_credentials
  alter column status type cert_status_enum
  using (case
    when status in ('active','expiring_soon','expired','renewed','revoked','pending_verification') then status::cert_status_enum
    else 'pending_verification'::cert_status_enum
  end);
alter table employee_credentials alter column status set default 'pending_verification';

-- ============================================================
-- firm_credentials — expand stub
-- ============================================================
alter table firm_credentials
  add column credential_number_encrypted   bytea,
  add column issuing_authority             text,
  add column jurisdiction                  text,
  add column issued_on                     date,
  add column expires_on                    date,
  add column renewal_window_starts_on      date,
  add column evidence_url                  text,
  add column notes                         text;

alter table firm_credentials alter column status drop default;
alter table firm_credentials
  alter column status type cert_status_enum
  using (case
    when status in ('active','expiring_soon','expired','renewed','revoked','pending_verification') then status::cert_status_enum
    else 'pending_verification'::cert_status_enum
  end);
alter table firm_credentials alter column status set default 'pending_verification';

-- ============================================================
-- Indexes for "expiring soon" dashboard queries
-- ============================================================
create index idx_employee_credentials_tenant_expires on employee_credentials(tenant_id, expires_on);
create index idx_employee_credentials_tenant_status  on employee_credentials(tenant_id, status);
create index idx_firm_credentials_tenant_expires     on firm_credentials(tenant_id, expires_on);
create index idx_firm_credentials_tenant_status      on firm_credentials(tenant_id, status);

-- updated_at triggers already created in 010_system_logs.sql:
--   trg_employee_credentials_updated_at, trg_firm_credentials_updated_at
-- The set_updated_at() function fires on every UPDATE so the new updated_at
-- column on the stub (also added in 010) keeps current.
