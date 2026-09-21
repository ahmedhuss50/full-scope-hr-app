-- 084_dsb_cases_vendor_link.sql
-- ----------------------------------------------------------------------------
-- Add a direct vendor link on dsb_cases so a disbursement voucher can be
-- assigned to the contractor/vendor it pays. This lets the vendor detail
-- page pull all cases for the vendor in one query — no receipt hop needed.
--
--   dsb_cases.vendor_id → dsb_vendors.id (nullable, SET NULL on delete)
--
-- Complements the existing dsb_cases.receipt_id (mig 078) which points to
-- a specific invoice. vendor_id is the coarser link — cases that are for a
-- vendor but not yet tied to a specific receipt still get grouped.
-- ----------------------------------------------------------------------------

alter table dsb_cases
  add column if not exists vendor_id uuid references dsb_vendors(id) on delete set null;

create index if not exists dsb_cases_vendor_idx on dsb_cases (tenant_id, vendor_id);

comment on column dsb_cases.vendor_id is
  'Contractor/vendor this disbursement voucher pays (dsb_vendors.id). Set from the case page vendor picker. Aggregates on the vendor detail page.';

notify pgrst, 'reload schema';
