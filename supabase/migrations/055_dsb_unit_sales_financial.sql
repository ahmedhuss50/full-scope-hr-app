-- 055_dsb_unit_sales_financial.sql
-- ============================================================================
-- Financial tracking columns from the master-list Excel (e.g. "سجل الربع
-- الأول 2026 اصالة الجوان.xlsx") that the initial 054 schema didn't capture.
--
-- Every column is nullable — many older files won't have every field, and
-- some ship a subset (e.g. price_per_meter without retention_percentage).
-- All values are captured "as-is" at import time and displayed read-only.
--
-- RUN ORDER: depends on 054 (dsb_unit_sales).
-- ============================================================================

alter table dsb_unit_sales
  add column if not exists retention_percentage             numeric,
  add column if not exists installment_number               int,
  add column if not exists total_collected_before_tax_sar   numeric,
  add column if not exists total_collected_with_tax_sar     numeric,
  add column if not exists remaining_amount_sar             numeric,
  add column if not exists collection_percentage            numeric,
  add column if not exists price_per_meter_sar              numeric;
