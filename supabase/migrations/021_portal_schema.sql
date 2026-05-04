-- 021_portal_schema.sql
-- Client Portal — phase 2 / PIVOT block. Adds two tenant-isolated tables that
-- power the SEPARATE authenticated experience for the firm's clients (NOT firm
-- staff). A client contact (e.g. CFO at Aramco) signs in at /portal and sees a
-- read-only slice of the firm's data scoped to their `client_id`.
--
-- Two tables:
--   portal_invitations  — which crm_contacts have been granted portal access +
--                         their session metadata (first_login, last_login).
--   portal_access_log   — append-only log of every portal session action
--                         (login, view_engagement, view_document, download,
--                         logout). Separate from the staff `audit_log` so we
--                         never confuse firm-staff actions with client actions.
--
-- Auth model: same Supabase Auth project as firm staff. The DIFFERENCE is
-- mapping — firm staff are matched to `users.email`, portal clients to
-- `portal_invitations.email`. A user in NEITHER → /portal/no-access.
--
-- RUN ORDER: depends on
--   001..020 (tenants/users + clients + crm_contacts + crm_seed)
--   - relies on `auth_tenant_id()` (012) and `uuid_generate_v4()` (001).

-- ============================================================
-- 1) portal_invitations — who is invited to /portal
-- ============================================================
create table portal_invitations (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  client_id           uuid not null references clients(id) on delete cascade,
  contact_id          uuid not null references crm_contacts(id) on delete cascade,
  email               text not null,
  invited_by_user_id  uuid references users(id),
  invited_at          timestamptz not null default now(),
  first_login_at      timestamptz,
  last_login_at       timestamptz,
  active              boolean not null default true,
  unique (tenant_id, contact_id)
);
create index on portal_invitations(tenant_id, email);
create index on portal_invitations(tenant_id, client_id);

-- ============================================================
-- 2) portal_access_log — append-only audit of portal sessions
-- ============================================================
create table portal_access_log (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  contact_id    uuid not null references crm_contacts(id) on delete cascade,
  action        text not null,        -- 'login','view_engagement','view_document','download_document','logout'
  entity_kind   text,                 -- 'engagement','document','invoice'
  entity_id     uuid,
  ip_address    text,
  user_agent    text,
  occurred_at   timestamptz not null default now()
);
create index on portal_access_log(tenant_id, contact_id, occurred_at desc);
create index on portal_access_log(tenant_id, client_id,  occurred_at desc);

-- ============================================================
-- 3) RLS — tenant isolation
-- ============================================================
alter table portal_invitations enable row level security;
alter table portal_access_log  enable row level security;

create policy portal_invitations_tenant on portal_invitations
  for all using (tenant_id = auth_tenant_id())
        with check (tenant_id = auth_tenant_id());

-- Portal access log is append-only (DEC-009 pattern, mirrors dms_access_log).
create policy portal_access_log_append on portal_access_log
  for insert with check (tenant_id = auth_tenant_id());
create policy portal_access_log_select on portal_access_log
  for select using (tenant_id = auth_tenant_id());
revoke update, delete on portal_access_log from public;
