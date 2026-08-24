-- 062_dsb_payments_deposit_category.sql
-- ----------------------------------------------------------------------------
-- Add a deposit_category column to dsb_payments so each deposit in the
-- سجل الإيداعات (payments list) can be tabbed / filtered by its purpose.
--
-- We use a text column with a CHECK constraint instead of an enum on purpose:
--   - Enums require a two-step migration when we add a new value (see 060).
--   - The set of categories may evolve; CHECK is trivial to widen.
--
-- Values (short internal codes → Arabic labels rendered in the UI):
--   buyer_collection  → تحصيل مشتري       (default; catches everything
--                                          that wasn't tagged otherwise)
--   wrong_transfer    → حوالة خاطئة
--   self_financing    → تمويل ذاتي
--   bank_financing    → تمويل بنكي
--   other             → أخرى
-- ----------------------------------------------------------------------------

alter table dsb_payments
  add column if not exists deposit_category text;

-- Backfill existing rows so the tab counts are meaningful on day one.
-- Everything currently in the ledger is assumed to be an ordinary buyer
-- collection unless the user reclassifies it in the UI.
update dsb_payments
  set deposit_category = 'buyer_collection'
  where deposit_category is null;

-- Now that no row is NULL, tighten the column: NOT NULL + CHECK.
alter table dsb_payments
  alter column deposit_category set default 'buyer_collection';

alter table dsb_payments
  alter column deposit_category set not null;

-- Drop-if-exists then add so re-runs against a live DB don't error.
alter table dsb_payments
  drop constraint if exists dsb_payments_deposit_category_check;
alter table dsb_payments
  add constraint dsb_payments_deposit_category_check
    check (deposit_category in (
      'buyer_collection',
      'wrong_transfer',
      'self_financing',
      'bank_financing',
      'other'
    ));

-- Index for the tab filter. Composite with tenant_id + payment_date so the
-- default "most recent first" ordering under a tab stays index-served.
create index if not exists dsb_payments_category_idx
  on dsb_payments (tenant_id, deposit_category, payment_date desc);

comment on column dsb_payments.deposit_category is
  'One of: buyer_collection | wrong_transfer | self_financing | bank_financing | other. Used to tab the deposits list.';

notify pgrst, 'reload schema';
