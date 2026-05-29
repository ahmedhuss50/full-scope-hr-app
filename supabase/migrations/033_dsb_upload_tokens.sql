-- 033_dsb_upload_tokens.sql
-- ============================================================================
-- DISBURSEMENTS — tokenized magic-link upload
-- ============================================================================
-- An employee/supervisor/owner generates a one-shot magic-link URL and sends
-- it to a developer's controller. The developer opens the URL (no login) and
-- uploads one combined PDF for a disbursement case at /upload-disbursement/[token].
--
-- Token storage: we mint 32 random bytes → 64-hex chars, then store ONLY a
-- sha256 hash of the raw token in the DB. The raw token never lives at rest.
-- The trustee sees the URL once at generation time.
--
-- RUN ORDER: depends on 030..032.
-- ============================================================================

create table dsb_upload_tokens (
  id                  uuid primary key default uuid_generate_v4(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  developer_id        uuid not null references dsb_developers(id) on delete cascade,
  project_id          uuid references dsb_projects(id) on delete set null,
  case_id             uuid references dsb_cases(id) on delete set null,
  token_hash          text not null unique,
  recipient_name      text not null,
  recipient_email     text not null,
  expires_at          timestamptz not null,
  used_at             timestamptz,
  revoked_at          timestamptz,
  created_by_user_id  uuid references users(id),
  notes               text,
  created_at          timestamptz not null default now()
);

create index dsb_upload_tokens_dev_idx  on dsb_upload_tokens (tenant_id, developer_id);
create index dsb_upload_tokens_hash_idx on dsb_upload_tokens (token_hash);

alter table dsb_upload_tokens enable row level security;
create policy dsb_tok_sel on dsb_upload_tokens for select using (tenant_id = auth_tenant_id());
create policy dsb_tok_mod on dsb_upload_tokens for all    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
