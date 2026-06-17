-- 041_dsb_upload_versions.sql
-- ----------------------------------------------------------------------------
-- Document-replacement tracking on dsb_uploads.
--
-- Why: during review, staff sometimes need to swap the uploaded PDF for a
-- corrected version (developer sent the wrong file, scan was unclear, etc.).
-- We want a clear audit trail of EVERY version: who replaced what, when, and
-- why — without losing the original.
--
-- Model:
--   - Multiple dsb_uploads rows per case_id (already allowed).
--   - `superseded_at` IS NULL  → this is the CURRENT active version.
--   - `superseded_at` IS NOT NULL → this version was replaced; readers should
--     usually show the active one instead but the old version stays in
--     Storage and is queryable for history.
--   - `replacement_reason` captures the why (optional, ≤ 500 chars).
--   - `replaced_by_user_id` is who clicked the replace button.
-- ----------------------------------------------------------------------------

alter table dsb_uploads
  add column if not exists superseded_at         timestamptz,
  add column if not exists replaced_by_user_id   uuid references public.users(id),
  add column if not exists replacement_reason    text;

-- Partial unique index so each case has at most one CURRENT (non-superseded)
-- upload. If we ever need multiple parallel current uploads (we don't today)
-- this can be dropped without affecting historical rows.
create unique index if not exists dsb_uploads_one_current_per_case_uq
  on dsb_uploads (case_id)
  where superseded_at is null;
