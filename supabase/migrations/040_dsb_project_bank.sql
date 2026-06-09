-- 040_dsb_project_bank.sql
-- ----------------------------------------------------------------------------
-- حساب المشروع — project-level banking details.
--
-- In Saudi off-plan real estate each project must run through a dedicated
-- escrow account (حساب الضمان العقاري). The money for THIS voucher comes
-- from the project's account, not the developer's general account.
--
-- Developer-level bank fields (added in 039) stay as-is and act as a
-- fallback when a project hasn't been tagged yet.
-- ----------------------------------------------------------------------------

alter table dsb_projects
  add column if not exists bank_name      text,
  add column if not exists bank_account   text,
  add column if not exists bank_iban      text;
