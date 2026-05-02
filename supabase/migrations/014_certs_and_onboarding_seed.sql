-- 014_certs_and_onboarding_seed.sql
-- Seed realistic Phase 3 / Block O cert + onboarding data for the Full Scope tenant
-- so the demo dashboard renders meaningful content.
--
-- RUN ORDER: this depends on `seed.sql` (the Full Scope tenant + departments +
-- practice areas + work locations) being applied first. Recommended sequence:
--   1) migrations 001 .. 013 (schema)
--   2) seed.sql               (Full Scope tenant + reference data)
--   3) migration 014          (cert + onboarding sample data)
-- If running migrations all-at-once, run seed.sql in the middle.
--
-- Tenant id:           11111111-1111-1111-1111-111111111111  (Full Scope, Dammam)
-- Departments (from seed.sql):
--   33333333-...001  Assurance
--   33333333-...002  Tax Services
--   33333333-...003  Advisory
-- Practice areas:
--   55555555-...001  Audit & Assurance
--   55555555-...002  Tax Services
-- Work location:
--   44444444-...001  Dammam HQ

-- ============================================================
-- 1) Sample employees (4) — realistic GCC accounting firm staff
-- ============================================================
insert into employees (
  id, tenant_id,
  legal_first_name, legal_last_name, preferred_name,
  primary_email, mobile_phone,
  home_address,
  employment_type, flsa_status, pay_type, pay_currency, pay_frequency, pay_method,
  hire_date,
  department_id, practice_area_id, job_title, work_location_id,
  active
) values
  -- 1. Layla Al-Otaibi — Senior Auditor (Assurance), hired 2 years ago
  ('66666666-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'Layla', 'Al-Otaibi', 'Layla',
    'layla.alotaibi@fullscope.sa', '+966551110301',
    '{"street_1":"King Fahd Rd","city":"Dammam","country_code":"SA","postal_code":"31411"}'::jsonb,
    'Full-time', 'Exempt', 'Salary', 'SAR', 'Monthly', 'Direct Deposit',
    (current_date - interval '2 years')::date,
    '33333333-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
    'Senior Auditor', '44444444-0000-0000-0000-000000000001',
    true),

  -- 2. Faisal Bin Hamad — Tax Manager (Tax Services), hired 3 years ago
  ('66666666-aaaa-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'Faisal', 'Bin Hamad', 'Faisal',
    'faisal.binhamad@fullscope.sa', '+966551110302',
    '{"street_1":"Prince Mohammed Rd","city":"Dammam","country_code":"SA","postal_code":"31411"}'::jsonb,
    'Full-time', 'Exempt', 'Salary', 'SAR', 'Monthly', 'Direct Deposit',
    (current_date - interval '3 years')::date,
    '33333333-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002',
    'Tax Manager', '44444444-0000-0000-0000-000000000001',
    true),

  -- 3. Ranya Saeed — Audit Senior (Assurance), hired 18 months ago
  ('66666666-aaaa-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'Ranya', 'Saeed', 'Ranya',
    'ranya.saeed@fullscope.sa', '+966551110303',
    '{"street_1":"Al Khobar Corniche","city":"Khobar","country_code":"SA","postal_code":"31952"}'::jsonb,
    'Full-time', 'Exempt', 'Salary', 'SAR', 'Monthly', 'Direct Deposit',
    (current_date - interval '18 months')::date,
    '33333333-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
    'Audit Senior', '44444444-0000-0000-0000-000000000001',
    true),

  -- 4. Yusuf Ibrahim — Junior Auditor (Assurance), hired 6 weeks ago — IN ONBOARDING
  ('66666666-aaaa-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    'Yusuf', 'Ibrahim', 'Yusuf',
    'yusuf.ibrahim@fullscope.sa', '+966551110304',
    '{"street_1":"Al Olaya St","city":"Dammam","country_code":"SA","postal_code":"31411"}'::jsonb,
    'Full-time', 'Non-exempt', 'Salary', 'SAR', 'Monthly', 'Direct Deposit',
    (current_date - interval '42 days')::date,
    '33333333-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
    'Junior Auditor', '44444444-0000-0000-0000-000000000001',
    true);

-- ============================================================
-- 2) Sample employee credentials (8 rows) — mix of urgency
-- ============================================================
-- Color band targets:
--   <30d / expired  -> red
--   30-60d          -> amber
--   60-180d         -> yellow
--   >180d           -> green

insert into employee_credentials (
  id, tenant_id, employee_id,
  credential_type, holder_role,
  issuing_authority, jurisdiction,
  issued_on, expires_on, renewal_window_starts_on,
  status, notes
) values
  -- Layla — SOCPA (active, 240d) GREEN
  ('66666666-bbbb-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000001',
    'SOCPA', 'Senior Auditor',
    'SOCPA', 'KSA',
    (current_date - interval '2 years')::date,
    (current_date + interval '240 days')::date,
    (current_date + interval '180 days')::date,
    'active', 'Saudi Organization for Chartered and Professional Accountants membership.'),

  -- Layla — CPA (US-CA), expiring in 28 days RED
  ('66666666-bbbb-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000001',
    'CPA', 'Senior Auditor',
    'AICPA', 'US-CA',
    (current_date - interval '4 years')::date,
    (current_date + interval '28 days')::date,
    (current_date - interval '32 days')::date,
    'expiring_soon', 'California Board of Accountancy biennial renewal due.'),

  -- Faisal — SOCPA (active, 400d) GREEN
  ('66666666-bbbb-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000002',
    'SOCPA', 'Tax Manager',
    'SOCPA', 'KSA',
    (current_date - interval '3 years')::date,
    (current_date + interval '400 days')::date,
    (current_date + interval '340 days')::date,
    'active', null),

  -- Faisal — ZATCA E-invoicing Cert, expiring in 55 days AMBER
  ('66666666-bbbb-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000002',
    'ZATCA E-invoicing', 'Tax Manager',
    'ZATCA', 'KSA',
    (current_date - interval '700 days')::date,
    (current_date + interval '55 days')::date,
    (current_date - interval '5 days')::date,
    'expiring_soon', 'ZATCA Phase 2 e-invoicing compliance certification.'),

  -- Faisal — CFA Level 3 (active, 800d) GREEN
  ('66666666-bbbb-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000002',
    'CFA Level 3', 'Tax Manager',
    'CFA Institute', 'Global',
    (current_date - interval '5 years')::date,
    (current_date + interval '800 days')::date,
    (current_date + interval '740 days')::date,
    'active', null),

  -- Ranya — SOCPA, expiring in 120 days YELLOW
  ('66666666-bbbb-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000003',
    'SOCPA', 'Audit Senior',
    'SOCPA', 'KSA',
    (current_date - interval '18 months')::date,
    (current_date + interval '120 days')::date,
    (current_date + interval '60 days')::date,
    'active', 'CPE hours 32/40 logged.'),

  -- Ranya — IFRS Diploma (active, 600d) GREEN
  ('66666666-bbbb-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000003',
    'IFRS Diploma', 'Audit Senior',
    'ICAEW', 'UK',
    (current_date - interval '2 years')::date,
    (current_date + interval '600 days')::date,
    (current_date + interval '540 days')::date,
    'active', null),

  -- Yusuf — ACCA Affiliate (active, 1000d) GREEN — recent
  ('66666666-bbbb-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000004',
    'ACCA Affiliate', 'Junior Auditor',
    'ACCA', 'UK',
    (current_date - interval '60 days')::date,
    (current_date + interval '1000 days')::date,
    (current_date + interval '940 days')::date,
    'active', 'SOCPA membership pending — to be obtained within 24 months per onboarding plan.');

-- One additional cert: an EXPIRED example for visual contrast (Layla — old EA)
insert into employee_credentials (
  id, tenant_id, employee_id,
  credential_type, holder_role,
  issuing_authority, jurisdiction,
  issued_on, expires_on, renewal_window_starts_on,
  status, notes
) values
  ('66666666-bbbb-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
    '66666666-aaaa-0000-0000-000000000001',
    'EA (Enrolled Agent)', 'Senior Auditor',
    'IRS', 'US',
    (current_date - interval '5 years')::date,
    (current_date - interval '14 days')::date,
    (current_date - interval '74 days')::date,
    'expired', 'Lapsed — renewal flagged for compliance officer review.');

-- ============================================================
-- 3) Sample firm credentials (5 rows)
-- ============================================================
insert into firm_credentials (
  id, tenant_id,
  credential_type,
  issuing_authority, jurisdiction,
  issued_on, expires_on, renewal_window_starts_on,
  status, notes
) values
  -- Firm SOCPA License (active, 300d) GREEN
  ('66666666-cccc-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'Firm SOCPA License',
    'SOCPA', 'KSA',
    (current_date - interval '3 years')::date,
    (current_date + interval '300 days')::date,
    (current_date + interval '240 days')::date,
    'active', 'Full Scope firm-level practising license.'),

  -- Peer Review Certificate, expiring in 45 days AMBER
  ('66666666-cccc-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'Peer Review Certificate',
    'SOCPA', 'KSA',
    (current_date - interval '3 years')::date,
    (current_date + interval '45 days')::date,
    (current_date - interval '15 days')::date,
    'expiring_soon', 'Triennial peer review — reviewer engagement signed.'),

  -- ZATCA E-invoicing Compliance, 180 days GREEN/borderline
  ('66666666-cccc-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'ZATCA E-invoicing Compliance',
    'ZATCA', 'KSA',
    (current_date - interval '1 year')::date,
    (current_date + interval '180 days')::date,
    (current_date + interval '120 days')::date,
    'active', 'Firm-level Phase 2 integration certification.'),

  -- ISO 27001, expiring in 90 days YELLOW
  ('66666666-cccc-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    'ISO 27001',
    'BSI', 'Global',
    (current_date - interval '2 years 9 months')::date,
    (current_date + interval '90 days')::date,
    (current_date + interval '30 days')::date,
    'active', 'Information security management system certification — recertification audit scheduled.'),

  -- Saudi MISA Investment License, 500d GREEN
  ('66666666-cccc-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
    'MISA Investment License',
    'MISA', 'KSA',
    (current_date - interval '500 days')::date,
    (current_date + interval '500 days')::date,
    (current_date + interval '440 days')::date,
    'active', 'Ministry of Investment of Saudi Arabia foreign-investment licence.');

-- ============================================================
-- 4) Onboarding seed — Junior Auditor track for Yusuf
-- ============================================================
-- Onboarding role
insert into onboarding_roles (id, tenant_id, name, classification, practice_area_id, active) values
  ('66666666-dddd-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'Junior Auditor', 'audit', '55555555-0000-0000-0000-000000000001', true);

-- Onboarding track
insert into onboarding_tracks (id, tenant_id, onboarding_role_id, name, order_index, active) values
  ('66666666-eeee-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    '66666666-dddd-0000-0000-000000000001', 'First 90 Days', 0, true);

-- 8 onboarding modules across Day 1 / 7 / 30 / 60 / 90
insert into onboarding_modules (
  id, tenant_id, onboarding_track_id, kind, title, content_ref,
  duration_minutes, required, order_index, active
) values
  -- Day 1
  ('66666666-ffff-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    '66666666-eeee-0000-0000-000000000001', 'video',   'Welcome + Office Tour',
    'day1', 30, true, 1, true),
  ('66666666-ffff-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    '66666666-eeee-0000-0000-000000000001', 'signoff', 'Sign Employment Documents',
    'day1', null, true, 2, true),
  -- Day 7
  ('66666666-ffff-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    '66666666-eeee-0000-0000-000000000001', 'doc',     'Read Audit Methodology Handbook',
    'day7', 120, true, 3, true),
  ('66666666-ffff-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    '66666666-eeee-0000-0000-000000000001', 'quiz',    'IFRS Refresher Quiz',
    'day7', 60, true, 4, true),
  -- Day 30
  ('66666666-ffff-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
    '66666666-eeee-0000-0000-000000000001', 'signoff', 'Shadow Senior on First Engagement',
    'day30', null, true, 5, true),
  ('66666666-ffff-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
    '66666666-eeee-0000-0000-000000000001', 'checkin', '30-day check-in with Manager',
    'day30', 30, true, 6, true),
  -- Day 60
  ('66666666-ffff-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
    '66666666-eeee-0000-0000-000000000001', 'signoff', 'Independent Audit Section Assignment',
    'day60', null, true, 7, true),
  -- Day 90
  ('66666666-ffff-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
    '66666666-eeee-0000-0000-000000000001', 'checkin', '90-day Performance Review',
    'day90', 60, true, 8, true);

-- Yusuf has completed Day 1 + Day 7 modules (4 of 8)
insert into onboarding_completions (tenant_id, employee_id, onboarding_module_id, completed_at) values
  ('11111111-1111-1111-1111-111111111111', '66666666-aaaa-0000-0000-000000000004',
    '66666666-ffff-0000-0000-000000000001', now() - interval '40 days'),
  ('11111111-1111-1111-1111-111111111111', '66666666-aaaa-0000-0000-000000000004',
    '66666666-ffff-0000-0000-000000000002', now() - interval '40 days'),
  ('11111111-1111-1111-1111-111111111111', '66666666-aaaa-0000-0000-000000000004',
    '66666666-ffff-0000-0000-000000000003', now() - interval '34 days'),
  ('11111111-1111-1111-1111-111111111111', '66666666-aaaa-0000-0000-000000000004',
    '66666666-ffff-0000-0000-000000000004', now() - interval '33 days');
