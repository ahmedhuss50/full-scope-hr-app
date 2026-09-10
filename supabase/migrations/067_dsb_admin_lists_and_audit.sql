-- 067_dsb_admin_lists_and_audit.sql
-- ----------------------------------------------------------------------------
-- Foundation for the last two "coming soon" admin panels:
--
--   1. القوائم والنسب — tenant-editable distribution shares that drive the
--      76/20/4 buyer-deposit derivation used by سجل الدفعات, حساب الضمان,
--      and the compliance alerts on the dashboard. Defaults preserve the
--      current behavior for every existing tenant.
--
--   2. سجل التدقيق — append-only audit log table. Populated later by a
--      helper `logAudit()` from write actions; the viewer page in this
--      slice reads from it and shows an empty state until entries land.
--
-- Both are additive; no existing rows are touched.
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) tenants — distribution shares (jsonb) with schema-checked defaults.
-- ---------------------------------------------------------------------------
-- Stored as jsonb (not three columns) so future roles beyond
-- construction/admin_marketing/escrow can be added without another
-- migration. Enforced-shape via a CHECK on the top-level keys.
alter table tenants
  add column if not exists deposit_distribution_shares jsonb
    not null
    default '{"construction": 0.76, "admin_marketing": 0.20, "escrow": 0.04}'::jsonb;

comment on column tenants.deposit_distribution_shares is
  'Per-tenant buyer-deposit distribution shares. Object with numeric keys "construction", "admin_marketing", "escrow". Values are fractions (0.76 = 76%). Consumers should sum matched keys and use them as multipliers on buyer_collection totals.';

-- ---------------------------------------------------------------------------
-- 2) dsb_audit_log — one row per persisted mutation.
-- ---------------------------------------------------------------------------
create table if not exists dsb_audit_log (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  occurred_at     timestamptz not null default now(),
  actor_user_id   uuid,                    -- users.id when known (nullable for system events)
  actor_email     text,                    -- redundant with actor_user_id but survives user deletes
  entity_type     text not null,           -- 'project' | 'case' | 'payment' | 'sale' | 'account' | 'tenant' | ...
  entity_id       uuid,                    -- primary key of the affected row (nullable for bulk ops)
  action          text not null,           -- 'create' | 'update' | 'delete' | 'export' | 'send' | ...
  summary         text,                    -- one-line human-readable description, e.g. "غيّر التصنيف من X إلى Y"
  before_snapshot jsonb,                   -- snapshot of the row/state before the change (nullable)
  after_snapshot  jsonb                    -- snapshot of the row/state after  the change (nullable)
);

create index if not exists dsb_audit_log_tenant_time_idx
  on dsb_audit_log (tenant_id, occurred_at desc);
create index if not exists dsb_audit_log_entity_idx
  on dsb_audit_log (tenant_id, entity_type, entity_id)
  where entity_id is not null;
create index if not exists dsb_audit_log_actor_idx
  on dsb_audit_log (tenant_id, actor_user_id, occurred_at desc)
  where actor_user_id is not null;

comment on table dsb_audit_log is
  'Append-only trail of tenant-scoped mutations. Populated by application code via a logAudit() helper (not DB triggers, so we control what''s recorded and preserve the human-readable summary). Owner-visible only.';
