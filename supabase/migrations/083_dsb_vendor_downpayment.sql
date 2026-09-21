-- 083_dsb_vendor_downpayment.sql
-- ----------------------------------------------------------------------------
-- Per-vendor developer downpayment pool (separate from the project-level
-- one). Same shape as dsb_projects.developer_downpayment_* (mig 079 + 080).
--
--   dsb_vendors.developer_downpayment_sar   → total the developer committed
--                                              to this contractor across all
--                                              their contracts on the project
--   dsb_vendors.developer_downpayment_plan  → JSONB milestone plan
--     [{ seq, label_ar, completion_pct, amount_sar, released_at }, ...]
--
-- Coexists with dsb_vendor_contracts.payment_schedule (contract-level
-- installment plan from mig 078). App shows both:
--   - vendor-level pool at the top of the receipts panel
--   - contract-level installment schedule per contract
-- ----------------------------------------------------------------------------

alter table dsb_vendors
  add column if not exists developer_downpayment_sar  numeric(14, 2) not null default 0,
  add column if not exists developer_downpayment_plan jsonb;

comment on column dsb_vendors.developer_downpayment_sar is
  'Total downpayment the developer has committed to this vendor across all their contracts on the project. Owner-editable.';
comment on column dsb_vendors.developer_downpayment_plan is
  'JSONB array of {seq, label_ar, completion_pct, amount_sar, released_at}. Milestone-based release plan for this vendor''s downpayment. Sum of amount_sar should equal developer_downpayment_sar.';

notify pgrst, 'reload schema';
