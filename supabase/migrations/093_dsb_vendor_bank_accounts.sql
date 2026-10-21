-- 093_dsb_vendor_bank_accounts.sql
-- ============================================================================
-- Multiple bank accounts per vendor. Previously dsb_vendors carried a single
-- (bank_name, iban) pair — the owner reasonably needs more than one (vendors
-- commonly use separate accounts per project, per currency, or for
-- audit/compliance purposes). This table is the many-to-one side.
--
-- The legacy dsb_vendors.bank_name + .iban columns stay as a cached "primary"
-- so existing queries (CPA export, حساب الضمان report, downstream integrations)
-- keep working unchanged — a trigger below mirrors the row flagged
-- is_primary=true back onto dsb_vendors on insert/update/delete.
-- ============================================================================

begin;

create table if not exists dsb_vendor_bank_accounts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  vendor_id            uuid not null references dsb_vendors(id) on delete cascade,
  bank_name            text,
  iban                 text,
  account_number       text,
  account_holder_name  text,
  is_primary           boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One primary account per vendor, enforced by a unique partial index.
create unique index if not exists dsb_vendor_bank_accounts_primary_idx
  on dsb_vendor_bank_accounts (vendor_id)
  where is_primary = true;

-- Browse index.
create index if not exists dsb_vendor_bank_accounts_vendor_idx
  on dsb_vendor_bank_accounts (vendor_id);

-- Standard updated_at trigger.
create trigger trg_dsb_vendor_bank_accounts_updated_at
  before update on dsb_vendor_bank_accounts
  for each row execute function set_updated_at();

-- Mirror the primary bank account onto dsb_vendors.{bank_name,iban} so
-- downstream readers that still consume the flat columns stay accurate.
create or replace function sync_primary_vendor_bank_account() returns trigger
language plpgsql as $$
declare
  target_vendor uuid;
  prim record;
begin
  target_vendor := coalesce(new.vendor_id, old.vendor_id);
  if target_vendor is null then return coalesce(new, old); end if;

  select bank_name, iban into prim
  from dsb_vendor_bank_accounts
  where vendor_id = target_vendor and is_primary = true
  limit 1;

  update dsb_vendors
     set bank_name = prim.bank_name,
         iban      = prim.iban
   where id = target_vendor;

  return coalesce(new, old);
end;
$$;

create trigger trg_dsb_vendor_bank_accounts_sync
  after insert or update or delete on dsb_vendor_bank_accounts
  for each row execute function sync_primary_vendor_bank_account();

-- RLS: same policy pattern as the parent table.
alter table dsb_vendor_bank_accounts enable row level security;
create policy dsb_vba_sel on dsb_vendor_bank_accounts
  for select using (tenant_id = auth_tenant_id());
create policy dsb_vba_mod on dsb_vendor_bank_accounts
  for all using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

commit;
