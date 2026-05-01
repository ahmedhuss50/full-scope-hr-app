-- 012_rls_policies.sql
-- Row-Level Security policies enforcing tenant_id = JWT tenant claim.
-- Pattern: every tenant-scoped table has a SELECT policy and an ALL policy.
-- The service_role bypasses RLS by default in Supabase.
-- Global reference tables (gcc_countries, roles) have RLS disabled — public read.

-- Tables WITH a tenant_id column — apply the standard tenant-isolation policy.
-- (tenants and user_roles are special-cased below: tenants uses its own id; user_roles derives via users.)
do $$
declare
  t text;
  tables text[] := array[
    'firm_settings',
    'users',
    'departments','work_locations','practice_areas','job_requisitions',
    'candidates','applications','application_status_history',
    'interviews','interview_slots','interview_recordings','interview_transcripts',
    'interview_scorecards','interview_decisions',
    'hire_events','employees','vendors','employee_pay_rate_history',
    'classification_changes','emergency_contacts',
    'document_templates','documents','document_signatures',
    'gcc_compliance_records','background_checks','drug_tests','direct_deposit_accounts',
    'benefits_classes','benefit_plans','benefit_enrollments',
    'pto_policies','pto_balances','pto_transactions',
    'onboarding_roles','onboarding_tracks','onboarding_modules','onboarding_completions',
    'qbo_connections','xero_connections','sage_connections',
    'sync_queue','sync_events',
    'audit_log','pii_access_log','notification_templates','notification_log',
    'translations',
    -- Phase 2 / 3 stubs
    'clients','engagements','employee_credentials','firm_credentials'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy %I_tenant_select on %I for select using (
      tenant_id = auth_tenant_id()
    );$p$, t, t);
    execute format($p$create policy %I_tenant_modify on %I for all using (
      tenant_id = auth_tenant_id()
    ) with check (
      tenant_id = auth_tenant_id()
    );$p$, t, t);
  end loop;
end
$$;

-- Special cases --

-- Tenants table: PK 'id' IS the tenant identifier (no tenant_id column).
-- A user can SELECT/UPDATE only their own tenant row.
alter table tenants enable row level security;
create policy tenants_self_select on tenants
  for select using (id = auth_tenant_id());
create policy tenants_self_modify on tenants
  for all using (id = auth_tenant_id())
        with check (id = auth_tenant_id());

-- User_roles table: bridge table with no tenant_id. Derive tenant via users.tenant_id.
-- A user_roles row is visible/modifiable iff its user belongs to the current tenant.
alter table user_roles enable row level security;
create policy user_roles_tenant_select on user_roles
  for select using (
    user_id in (select id from users where tenant_id = auth_tenant_id())
  );
create policy user_roles_tenant_modify on user_roles
  for all using (
    user_id in (select id from users where tenant_id = auth_tenant_id())
  ) with check (
    user_id in (select id from users where tenant_id = auth_tenant_id())
  );

-- Global reference tables: RLS stays off (readable by all authenticated users).
-- gcc_countries, roles — no policies.

-- Candidate portal users: can read/update their own candidate record only.
-- Assumes JWT contains a 'candidate_id' claim when the user logs into the candidate portal.

create or replace function auth_candidate_id()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'candidate_id', '')::uuid;
$$;

create policy candidate_self_read on candidates
  for select using (
    auth_candidate_id() is not null and id = auth_candidate_id()
  );

create policy candidate_self_update on candidates
  for update using (
    auth_candidate_id() is not null and id = auth_candidate_id()
  ) with check (
    auth_candidate_id() is not null and id = auth_candidate_id()
  );

-- PII Access Log is append-only for everyone including HR (DEC-009).
-- Only the service_role (sync workers) inserts on behalf of users; updates/deletes blocked.
create policy pii_access_log_append_only on pii_access_log
  for insert with check (tenant_id = auth_tenant_id());

revoke update, delete on pii_access_log from public;

-- Audit log is also append-only (DEC-009).
create policy audit_log_append_only on audit_log
  for insert with check (tenant_id = auth_tenant_id());

revoke update, delete on audit_log from public;
