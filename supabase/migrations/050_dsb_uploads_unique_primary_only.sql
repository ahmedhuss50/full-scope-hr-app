-- 050_dsb_uploads_unique_primary_only.sql
-- ----------------------------------------------------------------------------
-- Fix: the partial unique index from migration 041 was created BEFORE we
-- introduced the `category` column (migration 045). It enforces "only one
-- current upload per case" via `unique (case_id) where superseded_at is null`
-- — but now that we have supplementary attachments (category='supplementary',
-- also superseded_at IS NULL), the constraint fires when a case has both a
-- primary doc and ANY attachment.
--
-- Manifestation: 23505 — `duplicate key value violates unique constraint
-- "dsb_uploads_one_current_per_case_uq"` when uploading an attachment OR
-- replacing the primary on a case that already has attachments.
--
-- Fix: replace the index with a tighter version that only enforces "one
-- current PRIMARY per case." Supplementary attachments are unrestricted.
-- ----------------------------------------------------------------------------

drop index if exists dsb_uploads_one_current_per_case_uq;

create unique index if not exists dsb_uploads_one_current_per_case_uq
  on dsb_uploads (case_id)
  where superseded_at is null and category = 'primary';
