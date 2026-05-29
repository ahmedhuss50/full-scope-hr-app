-- 031_dsb_seed.sql
-- ============================================================================
-- DISBURSEMENT WORKFLOW — seed data
-- ============================================================================
-- Bootstraps the four-role workflow for the Full Scope tenant:
--   - tags the owner accounts as `dsb_role='owner'`
--   - tags the in-house supervisor account as `dsb_role='supervisor'`
--   - creates ONE sample project and ONE sample developer so the UI has
--     something to render after migration; the case inbox is deliberately
--     empty — Ahmed will create the first real case via the developer UI.
--
-- Convention for fixed UUIDs (this migration):
--   dddd0001-...      developer (TMG-KSA)
--   dddd0002-...      project   (Madra Plot 2)
--
-- Tenant id: 11111111-1111-1111-1111-111111111111  (Full Scope, Dammam)
--
-- RUN ORDER: 030_dsb_schema.sql.
-- ============================================================================

-- ============================================================
-- A) Role tagging on existing users
-- ============================================================
-- Ahmed (the firm owner) can play Mahdi during demos by being tagged 'owner'.
update users
   set dsb_role = 'owner'
 where email = 'support@elevatemybusiness.co'
   and dsb_role is null;

-- Mahdi's real account if it exists.
update users
   set dsb_role = 'owner'
 where email = 'mahdi@fullscope.sa'
   and dsb_role is null;

-- The in-house supervisor account.
update users
   set dsb_role = 'supervisor'
 where email = 'emaneurse@gmail.com'
   and dsb_role is null;

-- ============================================================
-- B) Sample project — Madra Plot 2
-- ============================================================
-- IMPORTANT: assigned_employee_id is left NULL. Assign manually once the
-- accountant user is created and tagged `dsb_role='employee'`.
insert into dsb_projects (
  id, tenant_id, code, name_ar, assigned_employee_id, status, notes,
  created_at, updated_at
) values (
  'dddd0002-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'DSB-001',
  'مشروع مدرا — قطعة ٢',
  null,
  'active',
  'مشروع نموذجي. عيّن الموظف المسؤول يدويًا بعد إنشاء حسابه.',
  now(),
  now()
) on conflict (id) do nothing;

-- ============================================================
-- C) Sample developer — TMG-KSA
-- ============================================================
-- user_id is left NULL on purpose. Create the developer login account
-- manually, then run:
--   update dsb_developers set user_id = '<new-user-id>'
--    where id = 'dddd0001-0000-0000-0000-000000000001';
insert into dsb_developers (
  id, tenant_id, company_name_ar, contact_name, contact_email,
  user_id, status, notes, created_at, updated_at
) values (
  'dddd0001-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'مجموعة طلعت مصطفى — السعودية',
  'إدارة المشاريع',
  'finance@tmg-ksa.example.com',
  null,
  'active',
  'مطوّر نموذجي. أنشئ حساب المستخدم الخاص بهم يدويًا ثم ارفق user_id.',
  now(),
  now()
) on conflict (id) do nothing;

-- No demo cases — inbox starts empty so the user creates real cases via the UI.
