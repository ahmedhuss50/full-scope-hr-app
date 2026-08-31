-- 064_dsb_payments_link_to_sale.sql
-- ----------------------------------------------------------------------------
-- Payments now link to CONTRACTS (dsb_unit_sales), not directly to units.
--
-- Rationale: one unit can be resold, refinanced, or transferred between
-- buyers over its lifetime → multiple sale/contract rows per unit. Linking
-- a payment straight to the unit was ambiguous ("whose money is this?").
-- Linking to the contract nails the buyer + terms + unit in one step:
--     payment → sale (contract) → unit
--
-- Migration path:
--   1) Add `sale_id` column to dsb_payments (FK to dsb_unit_sales).
--   2) Best-effort backfill from the existing `unit_id`: for each payment
--      that has a unit but no sale, attach the MOST RECENT sale on that
--      unit. Payments spanning multiple sales get the newest — the manual
--      edit UI (task #190) lets an owner correct any misassignment.
--   3) Keep `unit_id` in the schema for now (deprecated, harmless). We
--      derive the unit at query time from sale.unit_id when sale_id is set,
--      so removing the column later is a purely cosmetic follow-up.
--
-- Additive + idempotent. Safe on live DB.
-- ----------------------------------------------------------------------------

-- 1) New FK column. ON DELETE SET NULL so deleting the contract doesn't
--    delete the payment ledger row — the money still moved, just becomes
--    an orphan payment the owner can reassign.
alter table dsb_payments
  add column if not exists sale_id uuid
    references dsb_unit_sales(id) on delete set null;

create index if not exists dsb_payments_sale_idx
  on dsb_payments (sale_id)
  where sale_id is not null;

comment on column dsb_payments.sale_id is
  'Link to the contract (dsb_unit_sales) this payment belongs to. Preferred over unit_id — derive the unit via sale.unit_id when needed.';

-- 2) Best-effort backfill. For every payment with a unit but no sale,
--    pick the most recent sale on that unit. DISTINCT ON keeps one row per
--    unit; ORDER BY created_at DESC selects the newest.
--
--    Wrapped in a DO block so re-running is a no-op (only touches NULL
--    sale_id rows).
do $$
begin
  with latest_sale_per_unit as (
    select distinct on (unit_id)
      unit_id,
      id as sale_id
    from dsb_unit_sales
    where unit_id is not null
    order by unit_id, created_at desc
  )
  update dsb_payments p
    set sale_id = ls.sale_id
    from latest_sale_per_unit ls
    where p.sale_id is null
      and p.unit_id is not null
      and ls.unit_id = p.unit_id;
end $$;

notify pgrst, 'reload schema';
