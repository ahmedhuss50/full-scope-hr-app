-- 047_dsb_role_viewer_deliverer.sql
-- ----------------------------------------------------------------------------
-- Extend dsb_role enum with two narrowly-scoped roles:
--
--   * viewer    (مشاهد) — read-only access to everything. Can open every
--                         page, download files, but cannot upload, edit,
--                         approve, sign, deliver, comment, or attach.
--   * deliverer (مسلم)  — can do everything a viewer can PLUS mark a signed
--                         case as delivered. No other write power.
--
-- The application enforces the permission split in code (page gates +
-- server action ACLs). We use ALTER TYPE because adding values to an
-- existing enum is the supported, non-disruptive path.
-- ----------------------------------------------------------------------------

-- IF NOT EXISTS is supported on ALTER TYPE … ADD VALUE since PG 12. It makes
-- the migration idempotent if it's accidentally re-run.
alter type dsb_role add value if not exists 'viewer';
alter type dsb_role add value if not exists 'deliverer';
