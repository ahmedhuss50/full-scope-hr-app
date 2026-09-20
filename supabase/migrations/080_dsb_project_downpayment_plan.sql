-- 080_dsb_project_downpayment_plan.sql
-- ----------------------------------------------------------------------------
-- Milestone-based spending plan for the developer's downpayment.
--
--   dsb_projects.developer_downpayment_plan (JSONB array)
--     [{ seq, label_ar, completion_pct, amount_sar, released_at }, ...]
--
--   - seq            : ordering / stable key
--   - label_ar       : human label (e.g. "الدفعة الأولى — 10% إنجاز")
--   - completion_pct : project-completion trigger for this tranche (0–100)
--   - amount_sar     : amount released when this milestone is reached
--   - released_at    : ISO date when operator marked it released; null = pending
--
-- Spending is tracked externally (dsb_cases signed/delivered for the project).
-- Sum of amount_sar should equal dsb_projects.developer_downpayment_sar.
-- ----------------------------------------------------------------------------

alter table dsb_projects
  add column if not exists developer_downpayment_plan jsonb;

comment on column dsb_projects.developer_downpayment_plan is
  'JSONB array of {seq, label_ar, completion_pct, amount_sar, released_at}. Milestone-based release plan for the developer downpayment. Sum of amount_sar should equal developer_downpayment_sar.';

notify pgrst, 'reload schema';
