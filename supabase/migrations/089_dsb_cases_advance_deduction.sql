-- 089_dsb_cases_advance_deduction.sql
-- ----------------------------------------------------------------------------
-- Advance-payment recovery on regular invoice vouchers.
--
-- The developer pays an upfront advance to a contractor (tracked via
-- dsb_cases.is_downpayment + dsb_vendors.developer_downpayment_sar). With
-- every subsequent invoice from that contractor, a portion of the advance
-- gets deducted from the invoice amount — the net (invoice − deduction) is
-- what actually leaves the escrow account.
--
-- This migration adds two fields on dsb_cases to support that flow:
--
--   advance_deduction_sar   → how much of THIS invoice is being applied
--                              against the open advance balance. Non-zero
--                              only on non-advance vouchers (is_downpayment
--                              = false).
--   advance_deduction_pct   → the completion-% the user entered; kept for
--                              audit + display ("we deducted 20,000 because
--                              this invoice covers 10% of the contract").
--
-- Business rules (enforced in app layer, not DB):
--   • Only settable when vendor has a positive remaining advance balance.
--   • Cannot exceed the remaining advance balance.
--   • Cannot exceed the invoice's amount_sar.
--   • Net paid = amount_sar − advance_deduction_sar (that's what hits
--     escrow + CPA construction/admin buckets).
--
-- The remaining-advance balance for a vendor+project at any moment is:
--   SUM(amount_sar) WHERE is_downpayment=true      (advance paid out)
--   - SUM(advance_deduction_sar) WHERE is_downpayment=false   (recovered)
-- ----------------------------------------------------------------------------

alter table dsb_cases
  add column if not exists advance_deduction_sar numeric(14, 2) not null default 0,
  add column if not exists advance_deduction_pct numeric(5,  2);

comment on column dsb_cases.advance_deduction_sar is
  'Amount of THIS invoice applied against the vendor''s open developer-advance balance. Zero on advance vouchers themselves. Net escrow debit = amount_sar - advance_deduction_sar.';

comment on column dsb_cases.advance_deduction_pct is
  'Completion percentage the user entered when placing the deduction. Advisory / audit trail — the authoritative number is advance_deduction_sar.';

notify pgrst, 'reload schema';
