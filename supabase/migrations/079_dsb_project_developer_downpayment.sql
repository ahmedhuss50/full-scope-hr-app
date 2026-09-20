-- 079_dsb_project_developer_downpayment.sql
-- ----------------------------------------------------------------------------
-- Per-project developer downpayment pool. This is the money the DEVELOPER
-- puts down to pay vendors/contractors — a completely separate pool from
-- buyer collections. The "credit tracker" on the vendors page reads this
-- number and compares it to the total spent on signed/delivered vendor
-- disbursement cases to show the remaining downpayment balance.
--
-- Kept as a single numeric on the project (not a table of deposits) since
-- the operator just needs one running total they can top up as needed.
-- If per-tranche tracking is needed later, promote to a table.
-- ----------------------------------------------------------------------------

alter table dsb_projects
  add column if not exists developer_downpayment_sar numeric(14, 2) not null default 0;

comment on column dsb_projects.developer_downpayment_sar is
  'Total downpayment the developer has committed to this project (SAR). Read by the vendors-page tracker to compute remaining balance vs. vendor disbursements. Distinct from buyer collections. Owner-editable.';

notify pgrst, 'reload schema';
