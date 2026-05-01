-- 001_extensions.sql
-- Enable required Postgres extensions for Full-Scope-HR-Platform multi-tenant HR platform.
-- Supabase ships with these available; Enable in Dashboard or via this migration.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pgsodium";        -- column-level encryption
create extension if not exists "pg_stat_statements";

-- Shared trigger function: maintain updated_at
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Shared helper: require tenant_id = JWT tenant claim (used by RLS)
create or replace function auth_tenant_id()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid;
$$;

-- Shared helper: require role in JWT claims
create or replace function auth_has_role(role_key text)
returns boolean
language sql stable
as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'roles') ? role_key,
    false
  );
$$;
