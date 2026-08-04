-- 057_dsb_case_links_and_contract_unit_required.sql
-- ----------------------------------------------------------------------------
-- Two related changes that together let a disbursement case be auto-linked
-- to the specific unit / sale (buyer) / contract PDF it was raised against:
--
--   1) dsb_cases gains:
--        - sale_id     (FK → dsb_unit_sales.id  ON DELETE SET NULL)
--        - contract_id (FK → dsb_unit_contracts.id ON DELETE SET NULL)
--      unit_id already exists from migration 056. The AI extraction step in
--      /api/dsb-extract will fill these in when the PDF references identifying
--      fields (unit_number, contract_number, buyer_name, buyer_id_number).
--      All three FKs stay NULLABLE — auto-linking is best-effort. A case
--      without a matched unit/sale/contract still saves cleanly.
--
--   2) dsb_unit_contracts.unit_id becomes NOT NULL. Product rule: every
--      contract must belong to a unit. Rows that violate this today are
--      orphaned uploads (no unit was matched by the vision extractor); we
--      DELETE them so the constraint can land. If any tenant has valuable
--      orphan contracts they need first, run a manual UPDATE to attach them
--      before applying this migration.
--
-- Additive except for the DELETE of orphan contract rows. Idempotent on the
-- ALTER TABLE / ADD COLUMN parts (guarded by IF NOT EXISTS).
-- Safe to run against a live DB — the DELETE is scoped to unlinked contracts
-- only (unit_id IS NULL).
--
-- Also NOTIFIES pgrst so the PostgREST schema cache picks up the new
-- columns immediately (avoids the intermittent "column not found" from
-- clients that hit a stale cached schema).
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) Extend dsb_cases with sale_id + contract_id.
-- ---------------------------------------------------------------------------
alter table dsb_cases
  add column if not exists sale_id     uuid references dsb_unit_sales(id)     on delete set null,
  add column if not exists contract_id uuid references dsb_unit_contracts(id) on delete set null;

-- Partial indexes — most cases won't have these set (only unit-linked cases),
-- so partial keeps the index small and the "list cases linked to X" queries
-- fast.
create index if not exists dsb_cases_sale_idx
  on dsb_cases (sale_id)     where sale_id     is not null;
create index if not exists dsb_cases_contract_idx
  on dsb_cases (contract_id) where contract_id is not null;

-- ---------------------------------------------------------------------------
-- 2) dsb_unit_contracts: enforce "if we claim a contract is matched to a
--    unit, that unit_id MUST be set". Rows in 'pending' / 'no_match' /
--    'failed' are allowed to have unit_id NULL because they represent
--    states where the app is either still trying to find the unit or has
--    given up — in either case there is no false claim of linkage.
--
--    Only 'matched' rows carry the claim that the PDF has been positively
--    associated with a specific unit. The CHECK constraint ensures that
--    claim is backed by real data.
--
--    Any pre-existing 'matched' row with a NULL unit_id is buggy data and
--    is force-downgraded to 'no_match' so the constraint can land cleanly.
-- ---------------------------------------------------------------------------
update dsb_unit_contracts
  set extraction_status = 'no_match'
  where extraction_status = 'matched'
    and unit_id is null;

alter table dsb_unit_contracts
  drop constraint if exists dsb_unit_contracts_matched_requires_unit;

alter table dsb_unit_contracts
  add constraint dsb_unit_contracts_matched_requires_unit
  check (extraction_status <> 'matched' or unit_id is not null);

-- ---------------------------------------------------------------------------
-- 3) PostgREST schema reload — clients see the new columns without waiting
--    for the periodic cache refresh.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
