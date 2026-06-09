-- 038_dsb_extraction_cost.sql
-- ----------------------------------------------------------------------------
-- Per-case AI extraction cost tracking.
--
-- Each call to /api/dsb-extract pulls token usage from the Anthropic response
-- and writes it onto the case row, plus a USD cost computed at the model's
-- published rate. This lets us:
--   - See per-case spend on the detail page
--   - Sum monthly / per-developer spend for billing analysis
--   - Confirm that the Sonnet → Haiku switch is actually cheaper in practice
-- ----------------------------------------------------------------------------

alter table dsb_cases
  add column if not exists extraction_model              text,
  add column if not exists extraction_input_tokens       integer,
  add column if not exists extraction_output_tokens      integer,
  add column if not exists extraction_cache_read_tokens  integer,
  add column if not exists extraction_cache_write_tokens integer,
  add column if not exists extraction_cost_usd           numeric(10, 6),
  add column if not exists extracted_at                  timestamptz;
