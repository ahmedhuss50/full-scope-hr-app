-- 076_dsb_project_payment_schedule.sql
-- ----------------------------------------------------------------------------
-- Per-project buyer-payment installment schedule (جدول الدفعات).
--
-- Each project owns a 7-row schedule of installments:
--   { seq, label_ar, completion_pct, payment_pct }
--
-- Shipped defaults come from the Mohammed Al Habib template:
--   1  الدفعة الأولى (المقدمة)                   0%   20%
--   2  الثانية                                    20%  20%
--   3  الثالثة                                    40%  20%
--   4  الرابعة                                    60%  15%
--   5  الخامسة                                    70%  15%
--   6  السادسة                                    85%  5%
--   7  الدفعة الأخيرة عند الإفراغ او التسليم    100% 5%
--
-- Owners can override on the تهيئة المشروع screen. Percentages must sum to 100.
-- ----------------------------------------------------------------------------

alter table dsb_projects
  add column if not exists payment_schedule jsonb;

update dsb_projects set payment_schedule =
  '[
    {"seq":1, "label_ar":"الدفعة الأولى (المقدمة)",                     "completion_pct":0,   "payment_pct":20},
    {"seq":2, "label_ar":"الثانية",                                     "completion_pct":20,  "payment_pct":20},
    {"seq":3, "label_ar":"الثالثة",                                     "completion_pct":40,  "payment_pct":20},
    {"seq":4, "label_ar":"الرابعة",                                     "completion_pct":60,  "payment_pct":15},
    {"seq":5, "label_ar":"الخامسة",                                     "completion_pct":70,  "payment_pct":15},
    {"seq":6, "label_ar":"السادسة",                                     "completion_pct":85,  "payment_pct":5},
    {"seq":7, "label_ar":"الدفعة الأخيرة عند الإفراغ او التسليم",    "completion_pct":100, "payment_pct":5}
  ]'::jsonb
where payment_schedule is null;

comment on column dsb_projects.payment_schedule is
  'JSONB array of {seq, label_ar, completion_pct, payment_pct}. Defaults to the 7-row Mohammed Al Habib template; owners edit per-project via تهيئة المشروع.';
