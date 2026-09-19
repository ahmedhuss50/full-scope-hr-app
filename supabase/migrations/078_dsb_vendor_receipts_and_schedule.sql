-- 078_dsb_vendor_receipts_and_schedule.sql
-- ----------------------------------------------------------------------------
-- Contractor / vendor money-tracking:
--
--   1. dsb_vendor_contracts.payment_schedule (JSONB)
--        Per-contract installment plan (manual milestones):
--        [{ seq, label_ar, amount_sar, paid_at (null) }, ...]
--        Sum of amount_sar should equal the contract total. The "downpayment"
--        is just the first installment (seq=1) — no special flag needed.
--
--   2. dsb_vendor_receipts (new table)
--        One row per invoice the contractor submits. Optionally links to a
--        schedule installment (installment_seq). Optionally links to a
--        dsb_cases voucher (case_id) — the link is created when the
--        operator clicks "إنشاء سند صرف" on the receipt row.
--        status: pending → invoiced (case created) → paid (case marked paid).
--
--   3. dsb_cases.receipt_id (new column)
--        Case ↔ receipt link (nullable). When the case is marked paid, a
--        trigger flips the linked receipt to paid too and updates the
--        contract's paid-so-far totals.
-- ----------------------------------------------------------------------------

alter table dsb_vendor_contracts
  add column if not exists payment_schedule jsonb;

comment on column dsb_vendor_contracts.payment_schedule is
  'JSONB array of {seq, label_ar, amount_sar, paid_at}. Manual milestones — operator marks paid as work progresses. Sum should equal contract total.';

create table if not exists dsb_vendor_receipts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  vendor_id             uuid not null references dsb_vendors(id) on delete cascade,
  contract_id           uuid references dsb_vendor_contracts(id) on delete set null,
  installment_seq       int,                                        -- optional link into payment_schedule
  receipt_number        text,
  receipt_date          date,
  amount_before_tax_sar numeric(14, 2) not null default 0,
  vat_sar               numeric(14, 2) not null default 0,
  total_amount_sar      numeric(14, 2) generated always as (coalesce(amount_before_tax_sar,0) + coalesce(vat_sar,0)) stored,
  description           text,
  status                text not null default 'pending',
    -- 'pending' | 'invoiced' | 'paid'
  case_id               uuid references dsb_cases(id) on delete set null,
  attachment_storage_path text,
  attachment_filename     text,
  attachment_size_bytes   bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint dsb_vendor_receipts_status_chk
    check (status in ('pending', 'invoiced', 'paid'))
);

create index if not exists dsb_vendor_receipts_vendor_idx  on dsb_vendor_receipts (tenant_id, vendor_id);
create index if not exists dsb_vendor_receipts_contract_idx on dsb_vendor_receipts (contract_id);
create index if not exists dsb_vendor_receipts_case_idx    on dsb_vendor_receipts (case_id);

alter table dsb_cases
  add column if not exists receipt_id uuid references dsb_vendor_receipts(id) on delete set null;

create index if not exists dsb_cases_receipt_idx on dsb_cases (receipt_id);

-- Trigger: when a case is marked paid, flip its linked receipt to paid.
create or replace function dsb_case_paid_updates_receipt()
returns trigger language plpgsql as $$
begin
  if NEW.receipt_id is not null
     and NEW.status in ('signed','delivered')
     and (OLD.status is distinct from NEW.status)
  then
    update dsb_vendor_receipts
      set status = 'paid', updated_at = now()
      where id = NEW.receipt_id;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_dsb_case_paid_updates_receipt on dsb_cases;
create trigger trg_dsb_case_paid_updates_receipt
  after update on dsb_cases
  for each row execute procedure dsb_case_paid_updates_receipt();

notify pgrst, 'reload schema';
