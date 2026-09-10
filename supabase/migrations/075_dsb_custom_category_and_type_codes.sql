-- 075_dsb_custom_category_and_type_codes.sql
-- ----------------------------------------------------------------------------
-- Let owners add their own deposit categories + disbursement types beyond
-- the fixed enum shipped in code.
--
--   Storage: reuse the existing tenants.deposit_category_labels JSONB and
--            tenants.disbursement_type_labels JSONB. Custom codes MUST be
--            prefixed with `custom_` to keep them distinguishable from the
--            fixed enum codes.
--
-- DB constraint on dsb_payments.deposit_category currently rejects any
-- value outside the shipped enum. Widen it to also accept `custom_*` codes.
-- Disbursement type isn't a column — it's a JSONB field inside dsb_cases
-- extracted_fields — so no constraint change is needed there.
-- ----------------------------------------------------------------------------

alter table dsb_payments
  drop constraint if exists dsb_payments_deposit_category_check;

alter table dsb_payments
  add constraint dsb_payments_deposit_category_check
    check (
      deposit_category in (
        'buyer_collection',
        'wrong_transfer',
        'self_financing',
        'bank_financing',
        'other',
        'auto_distribution'
      )
      or deposit_category ~ '^custom_[a-z0-9_]{1,40}$'
    );

comment on constraint dsb_payments_deposit_category_check on dsb_payments is
  'Deposit-category codes: the six shipped enum values OR a tenant-defined custom_* code (owner adds these via القوائم والنسب).';

notify pgrst, 'reload schema';
