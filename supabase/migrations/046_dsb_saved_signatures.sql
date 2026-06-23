-- 046_dsb_saved_signatures.sql
-- ----------------------------------------------------------------------------
-- One reusable signature per user.
--
-- When a manager signs a case (or a delivery document), they can opt to save
-- the drawn strokes for next time. The composite (which adds الاسم/المنصب/
-- التاريخ labels around the signature) is rebuilt fresh on each use so the
-- date and any name/position edits stay current; we only persist the raw
-- strokes here.
--
-- Storage layout: signatures/<tenant_id>/<user_id>.png  (single PNG per user,
-- overwritten on update via upsert).
-- ----------------------------------------------------------------------------

create table if not exists dsb_saved_signatures (
  user_id        uuid primary key,
  tenant_id      uuid not null,
  storage_path   text not null,
  storage_bucket text not null default 'Document submission',
  updated_at     timestamptz not null default now()
);

create index if not exists dsb_saved_signatures_tenant_idx
  on dsb_saved_signatures (tenant_id);
