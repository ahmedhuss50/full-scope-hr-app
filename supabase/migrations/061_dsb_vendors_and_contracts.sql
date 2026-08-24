-- 061_dsb_vendors_and_contracts.sql
-- ----------------------------------------------------------------------------
-- Per-project vendor / service-provider directory + their contracts.
--
-- Purpose: give each project a directory of the outside companies working on
-- it (contractors, electricians, plumbers, marketing agencies, etc.) so the
-- owner can look up who did what, at what price, with what contract on file.
-- Complements the buyers side (dsb_unit_sales), which tracks the OTHER end of
-- the money flow.
--
-- Scope: per-project (dsb_vendors.project_id is NOT NULL). The same company
-- working on two projects gets two rows. This matches the units/buyers
-- pattern already in the app and keeps the auth model simple — every write
-- is scoped by project_id, no fan-out joins needed.
--
-- Auth (mirrors task #185):
--   ADD / EDIT : owner + supervisor + employee, but staff only for projects
--                they're assigned to (enforced in the server actions).
--   DELETE     : owner only.
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) dsb_vendors — one row per (project, vendor company).
-- ---------------------------------------------------------------------------
create table if not exists dsb_vendors (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references tenants(id) on delete cascade,
  project_id                 uuid not null references dsb_projects(id) on delete cascade,

  -- Company basics
  name_ar                    text not null,
  service_category           text,             -- فئة الخدمة (مقاول رئيسي, كهرباء, تسويق…)
  tax_number                 text,             -- الرقم الضريبي (VAT)
  commercial_registration    text,             -- السجل التجاري
  phone                      text,
  email                      text,
  iban                       text,

  -- Free-text list of prior projects / references
  references_text            text,             -- المراجع

  -- Optional contact person (rarely different from company phone/email but
  -- useful when the vendor is a big company with a project-specific rep)
  contact_person_name        text,
  contact_person_phone       text,

  notes                      text,

  created_by_user_id         uuid,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists dsb_vendors_project_idx
  on dsb_vendors (tenant_id, project_id, name_ar);

create index if not exists dsb_vendors_category_idx
  on dsb_vendors (tenant_id, project_id, service_category)
  where service_category is not null;

comment on table dsb_vendors is
  'Per-project directory of vendors / service providers (contractors, subcontractors, agencies). Referenced by dsb_vendor_contracts.';

-- ---------------------------------------------------------------------------
-- 2) dsb_vendor_contracts — 0..N contracts per vendor.
--    Deleting a vendor cascades to their contracts (rare enough to be fine,
--    and much simpler than orphan handling).
-- ---------------------------------------------------------------------------
create table if not exists dsb_vendor_contracts (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references tenants(id) on delete cascade,
  vendor_id                  uuid not null references dsb_vendors(id) on delete cascade,

  contract_number            text,             -- رقم العقد
  work_type                  text,             -- نوع العمل
  start_date                 date,             -- تاريخ البدء
  end_date                   date,             -- تاريخ الانتهاء
  total_amount_sar           numeric(14,2),    -- القيمة الإجمالية

  -- Contract status. Free text is fine for now (the UI shows a dropdown for
  -- the 3 common values). Widening later is trivial.
  --   active     — سارٍ
  --   completed  — منتهي
  --   cancelled  — ملغى
  status                     text not null default 'active',

  -- PDF attachment. Uses the same storage bucket as dsb_unit_contracts +
  -- dsb_uploads so we don't fan out storage config.
  storage_bucket             text,
  storage_path               text,             -- key inside the bucket
  filename                   text,
  file_size_bytes            bigint,

  notes                      text,

  created_by_user_id         uuid,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists dsb_vendor_contracts_vendor_idx
  on dsb_vendor_contracts (tenant_id, vendor_id, start_date desc nulls last);

create index if not exists dsb_vendor_contracts_status_idx
  on dsb_vendor_contracts (tenant_id, vendor_id, status);

comment on table dsb_vendor_contracts is
  'Contracts under a vendor. PDF attachment optional. status: active|completed|cancelled.';

-- ---------------------------------------------------------------------------
-- 3) updated_at auto-touch triggers (reuses the standard set_updated_at()
--    function that other dsb_* tables already use).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    -- vendors
    if not exists (
      select 1 from pg_trigger
      where tgname = 'dsb_vendors_set_updated_at'
    ) then
      create trigger dsb_vendors_set_updated_at
        before update on dsb_vendors
        for each row execute function set_updated_at();
    end if;
    -- contracts
    if not exists (
      select 1 from pg_trigger
      where tgname = 'dsb_vendor_contracts_set_updated_at'
    ) then
      create trigger dsb_vendor_contracts_set_updated_at
        before update on dsb_vendor_contracts
        for each row execute function set_updated_at();
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) RLS. Tenant isolation only — role-based checks live in server actions.
--    We're consistent with the rest of dsb_* tables here: RLS enforces "must
--    belong to my tenant" and every server action re-verifies dsb_role +
--    project scope before writing.
-- ---------------------------------------------------------------------------
alter table dsb_vendors           enable row level security;
alter table dsb_vendor_contracts  enable row level security;

drop policy if exists dsb_vendors_tenant_read on dsb_vendors;
create policy dsb_vendors_tenant_read on dsb_vendors
  for select using (
    tenant_id = (
      select tenant_id from users where users.id = auth.uid() limit 1
    )
  );

drop policy if exists dsb_vendor_contracts_tenant_read on dsb_vendor_contracts;
create policy dsb_vendor_contracts_tenant_read on dsb_vendor_contracts
  for select using (
    tenant_id = (
      select tenant_id from users where users.id = auth.uid() limit 1
    )
  );

-- Writes go through the service-role client from server actions, which
-- bypass RLS. We rely on the actions to enforce tenant + project-scope. No
-- INSERT/UPDATE/DELETE policies for the anon/authenticated roles.

notify pgrst, 'reload schema';
