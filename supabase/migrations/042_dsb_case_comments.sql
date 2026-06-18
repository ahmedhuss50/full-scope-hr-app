-- 042_dsb_case_comments.sql
-- ----------------------------------------------------------------------------
-- Per-case discussion thread.
--
-- Any tenant staff (employee/supervisor/owner) can post or read comments on
-- a case. Comments are soft-deleted via `deleted_at` so we keep the audit
-- trail and can undo accidental removals later if needed.
-- ----------------------------------------------------------------------------

create table if not exists dsb_case_comments (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  case_id         uuid not null references dsb_cases(id) on delete cascade,
  author_user_id  uuid not null references public.users(id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists dsb_case_comments_case_idx
  on dsb_case_comments (tenant_id, case_id, created_at);

drop trigger if exists trg_dsb_case_comments_updated_at on dsb_case_comments;
create trigger trg_dsb_case_comments_updated_at
  before update on dsb_case_comments
  for each row execute function set_updated_at();
