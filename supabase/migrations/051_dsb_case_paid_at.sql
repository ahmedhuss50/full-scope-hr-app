-- 051_dsb_case_paid_at.sql
-- ----------------------------------------------------------------------------
-- `paid_at` — the date the disbursement was actually paid out of the
-- chosen account. Distinct from voucher_date (when the voucher was issued)
-- and delivered_at (when the signed document was handed over to the
-- recipient). Editable inline on the archive row alongside the paid-from
-- account, since payment + delivery are typically logged together.
-- ----------------------------------------------------------------------------

alter table dsb_cases
  add column if not exists paid_at date;

create index if not exists dsb_cases_paid_at_idx
  on dsb_cases (paid_at);
