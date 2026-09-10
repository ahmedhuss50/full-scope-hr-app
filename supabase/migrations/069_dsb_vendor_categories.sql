-- 069_dsb_vendor_categories.sql
-- ----------------------------------------------------------------------------
-- Owner-editable list of vendor / service-provider categories
-- (تصنيفات الموردين ومقدمي الخدمات).
--
-- Today dsb_vendors.service_category is a free-text field. Introducing a
-- proper table lets the owner curate the list in one place («القوائم
-- والنسب»), the vendor form show it as a dropdown, and reports group
-- vendors consistently. No FK yet so we don't break historical rows —
-- the app will start suggesting from this list once populated and a
-- follow-up slice will migrate the free-text values.
-- ----------------------------------------------------------------------------

create table if not exists dsb_vendor_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name_ar    text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, name_ar)
);

create index if not exists dsb_vendor_categories_tenant_idx
  on dsb_vendor_categories (tenant_id, sort_order, name_ar);

comment on table dsb_vendor_categories is
  'Owner-curated list of vendor / service-provider categories. Managed from the القوائم والنسب admin page. Vendor form pulls from this list; not yet an FK on dsb_vendors.service_category to preserve legacy free-text values.';
