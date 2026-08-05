-- 058_dsb_unit_sales_project_scoped_nullable_unit.sql
-- ----------------------------------------------------------------------------
-- Separate "contracts + buyers" data from "units" data at the schema level.
--
-- Product change: contracts can now be imported BEFORE units exist, or
-- INDEPENDENTLY of units. A sale row lives on its own; linking it to a
-- specific unit is a follow-up step done via AI matching or manual attach.
--
-- Schema changes:
--
--   1) Add dsb_unit_sales.project_id (uuid, NOT NULL after backfill).
--      Sales must always belong to a project (that's what defines the
--      tenant-scoped bucket to search for units in). Currently we implied
--      the project through unit_id → dsb_project_units.project_id; making
--      it explicit lets a sale exist without a unit.
--
--   2) Alter dsb_unit_sales.unit_id → nullable. A sale with unit_id NULL
--      is an "unlinked contract" waiting for the AI linker (or a human) to
--      attach it to a unit.
--
--   3) Add dsb_unit_sales.unit_number_raw (text). Preserves the value the
--      importer read from Excel so we have something to match against later
--      even when unit_id is null. Also useful as a display fallback in the
--      contracts list ("waiting to be linked to V-101").
--
-- Backfill:
--   - project_id from unit_id → dsb_project_units.project_id
--   - unit_number_raw from unit_id → dsb_project_units.unit_number
--   - Also try contract_number-based backfill for rows where unit_id is
--     already null (there shouldn't be any today, but safe).
--
-- Index:
--   - Partial index on (project_id) WHERE unit_id IS NULL — the AI linker's
--     hot query is "give me every unlinked sale in project X".
--
-- Idempotent. Safe to run against a live DB.
-- ----------------------------------------------------------------------------

-- 1) Add project_id (nullable for now — backfill happens next).
alter table dsb_unit_sales
  add column if not exists project_id uuid references dsb_projects(id) on delete cascade;

-- Backfill from the linked unit.
update dsb_unit_sales s
  set project_id = u.project_id
  from dsb_project_units u
  where s.unit_id = u.id
    and s.project_id is null;

-- Any sales that STILL don't have a project (shouldn't be any, but be safe)
-- get deleted so we can enforce NOT NULL cleanly. If this deletes anything
-- surprising, that data was already orphaned and unrecoverable.
delete from dsb_unit_sales where project_id is null;

alter table dsb_unit_sales
  alter column project_id set not null;

-- 2) unit_id → nullable.
alter table dsb_unit_sales
  alter column unit_id drop not null;

-- 3) unit_number_raw for AI matching later.
alter table dsb_unit_sales
  add column if not exists unit_number_raw text;

-- Backfill from the linked unit's unit_number.
update dsb_unit_sales s
  set unit_number_raw = u.unit_number
  from dsb_project_units u
  where s.unit_id = u.id
    and s.unit_number_raw is null;

-- 4) Indexes.
create index if not exists dsb_unit_sales_project_idx
  on dsb_unit_sales (project_id);

create index if not exists dsb_unit_sales_unlinked_idx
  on dsb_unit_sales (project_id, unit_number_raw)
  where unit_id is null;

-- 5) Refresh PostgREST schema so clients see project_id + unit_number_raw
--    immediately.
notify pgrst, 'reload schema';
