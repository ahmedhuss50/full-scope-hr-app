-- 092_dsb_payments_contract_number_raw.sql
-- ============================================================================
-- Preserve the raw contract_number value the importer saw so a later
-- auto-link pass can retry matching payments → sales even for rows that
-- came in before the matching sale existed (common on fresh projects where
-- the payments file lands before the contracts file).
--
-- bulkImportPayments resolves contract_number → sale_id at insert time, but
-- discards the raw string. This column keeps it so /api/dsb-link-payments-to-sales
-- can replay the lookup.
-- ============================================================================

begin;

alter table dsb_payments
  add column if not exists contract_number_raw text;

-- Partial index: only index rows that still need linking.
create index if not exists dsb_payments_unlinked_contract_idx
  on dsb_payments (tenant_id, contract_number_raw)
  where sale_id is null and contract_number_raw is not null;

comment on column dsb_payments.contract_number_raw is
  'Original contract_number from the import (free-text, pre-normalization). ' ||
  'Preserved so a later auto-link pass can retry matching to a sale once the ' ||
  'corresponding contract gets imported.';

commit;
