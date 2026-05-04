-- 016_cost_tracking_seed.sql
-- Seed Phase 2 / Block N cost-tracking sample data for the Full Scope tenant.
-- Mirrors the structure of `014_certs_and_onboarding_seed.sql`: realistic KSA
-- accounting-firm data so the demo dashboard at /app/costs renders meaningfully.
--
-- RUN ORDER: depends on
--   1) migrations 001 .. 015 (schema + cost-tracking expand)
--   2) seed.sql               (Full Scope tenant, departments, practice areas)
--   3) migration 014          (employees Layla / Faisal / Ranya / Yusuf)
--
-- Tenant id:           11111111-1111-1111-1111-111111111111  (Full Scope, Dammam)
-- Lead partner:        22222222-0000-0000-0000-000000000003  (Managing Partner)
-- Practice areas:
--   55555555-...001  Audit & Assurance
--   55555555-...002  Tax Services
--   55555555-...003  Advisory
-- Employees (from 014):
--   66666666-aaaa-...001  Layla   (Senior Auditor — 350 SAR/hr)
--   66666666-aaaa-...002  Faisal  (Tax Manager     — 450 SAR/hr)
--   66666666-aaaa-...003  Ranya   (Audit Senior    — 280 SAR/hr)
--   66666666-aaaa-...004  Yusuf   (Junior Auditor  — 180 SAR/hr)

-- ============================================================
-- 1) Clients (4) — KSA-realistic anchor accounts
-- ============================================================
insert into clients (
  id, tenant_id, name, legal_name, trade_name, industry, country_code, vat_number,
  primary_contact_name, primary_contact_email, relationship_owner_id, since, status
) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'Aramco Services',     'Aramco Services Co.',          'Aramco',
    'Energy',              'SA', '300000000100003',
    'Khalid Al-Dosari',    'k.aldosari@aramco-services.sa',
    '22222222-0000-0000-0000-000000000003', date '2023-03-15', 'active'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'Saudi Telecom Group', 'Saudi Telecom Group',          'STC',
    'Telecom',             'SA', '300000000200003',
    'Maha Al-Sheikh',      'm.alsheikh@stc.com.sa',
    '22222222-0000-0000-0000-000000000003', date '2024-01-10', 'active'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'Al-Faisal Holding',   'Al-Faisal Holding Co.',        'AFH',
    'Investment',          'SA', '300000000300003',
    'Abdullah Al-Faisal',  'aalfaisal@afh-holding.sa',
    '22222222-0000-0000-0000-000000000003', date '2024-06-22', 'active'),
  ('cccccccc-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    'Diriyah Construction','Diriyah Construction LLC',     'Diriyah Build',
    'Construction',        'SA', '300000000400003',
    'Saad Al-Qahtani',     's.alqahtani@diriyah-build.sa',
    '22222222-0000-0000-0000-000000000003', date '2025-02-04', 'active');

-- ============================================================
-- 2) Engagements (6) — 4 active + 2 closed for prior-period revenue
-- ============================================================
insert into engagements (
  id, tenant_id, client_id, name, status,
  code, start_date, end_date,
  budget_hours, fee_amount, fee_currency,
  billed_amount, collected_amount,
  lead_partner_id, engagement_type, practice_area_id
) values
  -- ACTIVE: Aramco Q1 2026 Audit — on-track (~75% of 800 hrs)
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000001',
    'Q1 2026 Statutory Audit', 'active',
    'ENG-2026-001', date '2026-01-15', date '2026-06-30',
    800.00, 480000.00, 'SAR',
    240000.00, 180000.00,
    '22222222-0000-0000-0000-000000000003', 'Audit',
    '55555555-0000-0000-0000-000000000001'),

  -- ACTIVE: STC VAT Compliance Q1 — OVER BUDGET (~110% of 200 hrs)
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000002',
    'VAT Compliance Q1 2026', 'active',
    'ENG-2026-002', date '2026-02-01', date '2026-05-31',
    200.00, 100000.00, 'SAR',
    50000.00, 50000.00,
    '22222222-0000-0000-0000-000000000003', 'Tax',
    '55555555-0000-0000-0000-000000000002'),

  -- ACTIVE: Al-Faisal Advisory — under-utilized (~37% of 400 hrs, just started)
  ('eeeeeeee-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000003',
    'Strategic Advisory Engagement', 'active',
    'ENG-2026-003', date '2026-03-10', date '2026-08-15',
    400.00, 320000.00, 'SAR',
    80000.00, 0.00,
    '22222222-0000-0000-0000-000000000003', 'Advisory',
    '55555555-0000-0000-0000-000000000003'),

  -- ACTIVE: Diriyah Tax Advisory + ZATCA Setup — close to budget (~103% of 150)
  ('eeeeeeee-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000004',
    'Tax Advisory + ZATCA Phase 2 Setup', 'active',
    'ENG-2026-004', date '2026-03-01', date '2026-05-15',
    150.00, 90000.00, 'SAR',
    45000.00, 22500.00,
    '22222222-0000-0000-0000-000000000003', 'Tax',
    '55555555-0000-0000-0000-000000000002'),

  -- CLOSED: Aramco Q4 2025 Audit — full bill, partial collect (90%)
  ('eeeeeeee-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000001',
    'Q4 2025 Statutory Audit', 'closed',
    'ENG-2025-098', date '2025-10-01', date '2026-02-28',
    750.00, 450000.00, 'SAR',
    450000.00, 405000.00,
    '22222222-0000-0000-0000-000000000003', 'Audit',
    '55555555-0000-0000-0000-000000000001'),

  -- CLOSED: STC Tax Compliance — fully billed and collected
  ('eeeeeeee-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000002',
    'Tax Compliance Q4 2025', 'closed',
    'ENG-2025-095', date '2025-10-15', date '2026-01-31',
    180.00, 95000.00, 'SAR',
    95000.00, 95000.00,
    '22222222-0000-0000-0000-000000000003', 'Tax',
    '55555555-0000-0000-0000-000000000002');

-- ============================================================
-- 3) Time entries (~50 rows) across the 4 active engagements
-- ============================================================
-- Targets (per spec):
--   ENG-2026-001 ~600 actual hrs (75% of 800 — green)
--   ENG-2026-002 ~220 actual hrs (110% of 200 — RED)
--   ENG-2026-003 ~150 actual hrs (37% of 400 — green)
--   ENG-2026-004 ~155 actual hrs (103% of 150 — yellow)
-- Rate per role: Layla 350, Faisal 450, Ranya 280, Yusuf 180.

-- ---------- ENG-2026-001 (Aramco audit) — target ~600 hrs ----------
-- 14 entries, mix of 4 staff
insert into time_entries (tenant_id, engagement_id, employee_id, entry_date, hours, billable, billable_rate, description, status) values
  -- Layla (Senior Auditor)
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000001', date '2026-04-01', 7.5, true, 350, 'Walkthrough — revenue cycle', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000001', date '2026-04-03', 8.0, true, 350, 'Test of controls — payroll', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000001', date '2026-04-08', 6.5, true, 350, 'Substantive — receivables aging', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000001', date '2026-04-15', 8.0, true, 350, 'Site visit — Yanbu refinery', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000001', date '2026-04-22', 7.0, true, 350, 'Inventory observation — month-end', 'approved'),
  -- Ranya (Audit Senior)
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000003', date '2026-04-02', 8.0, true, 280, 'Sampling — vendor invoices', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000003', date '2026-04-05', 7.5, true, 280, 'Substantive — accruals testing', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000003', date '2026-04-12', 8.0, true, 280, 'Working paper review', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000003', date '2026-04-19', 7.5, true, 280, 'Risk assessment update', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000003', date '2026-04-26', 6.0, true, 280, 'Confirmations follow-up', 'approved'),
  -- Yusuf (Junior Auditor) — heavy hours doing fieldwork
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000004', date '2026-04-04', 8.0, true, 180, 'Vouching — operating expenses', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000004', date '2026-04-09', 7.0, true, 180, 'Cash reconciliation testing', 'submitted'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000004', date '2026-04-16', 8.0, true, 180, 'Documentation — workpapers', 'submitted'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000004', date '2026-04-23', 6.0, true, 180, 'Lead schedules update', 'submitted'),
  -- Faisal (Tax Manager) — engagement quality review
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000002', date '2026-04-29', 4.0, true, 450, 'EQR review — Aramco audit file', 'approved');

-- That gives Aramco 14 entries totaling: 37+37+37+24+4 = wait, let me sum:
-- Layla: 7.5+8+6.5+8+7 = 37.0
-- Ranya: 8+7.5+8+7.5+6 = 37.0
-- Yusuf: 8+7+8+6 = 29.0
-- Faisal: 4.0
-- Total ENG-001 from these 14 = 107h. Need ~600 — add bulk catch-up entries below.

-- Bulk historical entries (Jan-Mar) to bring total to ~600h on ENG-001
insert into time_entries (tenant_id, engagement_id, employee_id, entry_date, hours, billable, billable_rate, description, status) values
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000001', date '2026-01-22', 40.0, true, 350, 'Planning + risk assessment week', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000001', date '2026-02-20', 60.0, true, 350, 'Fieldwork — Q1 close cycle', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000001', date '2026-03-25', 55.0, true, 350, 'Substantive procedures — March', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000003', date '2026-01-29', 38.0, true, 280, 'Walkthrough documentation', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000003', date '2026-02-26', 65.0, true, 280, 'Substantive testing — Feb fieldwork', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000003', date '2026-03-28', 50.0, true, 280, 'Workpaper completion', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000004', date '2026-02-12', 45.0, true, 180, 'Ticking + tying — vouchers', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000004', date '2026-03-15', 60.0, true, 180, 'Fieldwork support', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000004', date '2026-03-31', 50.0, true, 180, 'Documentation closeout', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000002', date '2026-02-28', 12.0, true, 450, 'Partner review — interim', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001','66666666-aaaa-0000-0000-000000000002', date '2026-03-30', 18.0, true, 450, 'Partner review + client meeting', 'billed');

-- Adds: Layla 155 + Ranya 153 + Yusuf 155 + Faisal 30 = 493 more on ENG-001
-- Total ENG-001 = 107 + 493 = 600. Target met.

-- ---------- ENG-2026-002 (STC VAT) — target ~220 hrs ----------
insert into time_entries (tenant_id, engagement_id, employee_id, entry_date, hours, billable, billable_rate, description, status) values
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000002', date '2026-04-02', 8.0, true, 450, 'VAT return prep — Q1', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000002', date '2026-04-09', 7.5, true, 450, 'Reconciliation — output VAT', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000002', date '2026-04-16', 8.0, true, 450, 'ZATCA portal submission walkthrough', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000002', date '2026-04-23', 6.5, true, 450, 'Client review meeting', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000002', date '2026-04-30', 8.0, true, 450, 'Filing + amendment package', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000003', date '2026-04-04', 8.0, true, 280, 'Input VAT recon — telecom suppliers', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000003', date '2026-04-11', 7.0, true, 280, 'Sampling — invoice compliance', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000003', date '2026-04-18', 6.0, true, 280, 'Workpapers — output VAT', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000003', date '2026-04-25', 5.5, false, 280, 'Internal training — ZATCA Phase 2 (non-billable)', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000004', date '2026-04-08', 6.0, true, 180, 'Document gathering — vendor invoices', 'submitted'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000004', date '2026-04-15', 7.0, true, 180, 'Spreadsheet build — VAT schedule', 'submitted');

-- Sum so far ENG-002 (Apr): Faisal 38 + Ranya 26.5 + Yusuf 13 = 77.5
-- Add prior month bulk for catch-up to ~220
insert into time_entries (tenant_id, engagement_id, employee_id, entry_date, hours, billable, billable_rate, description, status) values
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000002', date '2026-02-15', 35.0, true, 450, 'Engagement scoping + planning', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000002', date '2026-03-20', 28.0, true, 450, 'Q1 in-flight reviews', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000003', date '2026-02-22', 40.0, true, 280, 'VAT data collection cycle', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000003', date '2026-03-25', 25.0, true, 280, 'Reconciliations — March', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000002','66666666-aaaa-0000-0000-000000000004', date '2026-03-10', 14.5, true, 180, 'Document indexing', 'billed');

-- ENG-002 total = 77.5 + 142.5 = 220. Target met.

-- ---------- ENG-2026-003 (Al-Faisal Advisory) — target ~150 hrs ----------
insert into time_entries (tenant_id, engagement_id, employee_id, entry_date, hours, billable, billable_rate, description, status) values
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000002', date '2026-04-07', 5.0, true, 450, 'Discovery workshop — strategy', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000002', date '2026-04-14', 6.5, true, 450, 'Financial model review', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000002', date '2026-04-21', 8.0, true, 450, 'Subsidiary structure analysis', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000002', date '2026-04-28', 7.0, true, 450, 'Steering committee meeting', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000001', date '2026-04-10', 6.0, true, 350, 'Benchmarking — peer firms', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000001', date '2026-04-17', 7.5, true, 350, 'Business case modelling', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000001', date '2026-04-24', 5.0, true, 350, 'Deliverable drafting', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000003', date '2026-04-19', 4.0, false, 280, 'Internal calibration session (non-billable)', 'approved');

-- Sum: Faisal 26.5 + Layla 18.5 + Ranya 4 = 49
-- Add bulk March entries for catch-up to ~150
insert into time_entries (tenant_id, engagement_id, employee_id, entry_date, hours, billable, billable_rate, description, status) values
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000002', date '2026-03-18', 30.0, true, 450, 'Engagement kickoff + scoping', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000002', date '2026-03-28', 22.0, true, 450, 'Initial workstream design', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000001', date '2026-03-22', 28.0, true, 350, 'Data room review + analysis', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000003','66666666-aaaa-0000-0000-000000000001', date '2026-03-30', 21.0, true, 350, 'Working sessions — March', 'billed');

-- ENG-003 total = 49 + 101 = 150. Target met.

-- ---------- ENG-2026-004 (Diriyah Tax + ZATCA) — target ~155 hrs ----------
insert into time_entries (tenant_id, engagement_id, employee_id, entry_date, hours, billable, billable_rate, description, status) values
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000002', date '2026-04-06', 7.5, true, 450, 'ZATCA Phase 2 readiness assessment', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000002', date '2026-04-13', 8.0, true, 450, 'E-invoicing integration design', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000002', date '2026-04-20', 6.0, true, 450, 'Tax position memorandum', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000002', date '2026-04-27', 8.0, true, 450, 'Final advisory deck + client review', 'approved'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000004', date '2026-04-08', 7.0, true, 180, 'Document gathering — historical filings', 'submitted'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000004', date '2026-04-15', 8.0, true, 180, 'Spreadsheet — VAT mapping', 'submitted'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000004', date '2026-04-22', 6.5, true, 180, 'Workpaper compilation', 'submitted'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000004', date '2026-04-29', 5.0, true, 180, 'ZATCA portal testing', 'submitted');

-- Sum: Faisal 29.5 + Yusuf 26.5 = 56
-- Add bulk March for catch-up to ~155
insert into time_entries (tenant_id, engagement_id, employee_id, entry_date, hours, billable, billable_rate, description, status) values
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000002', date '2026-03-12', 35.0, true, 450, 'Initial assessment + scoping', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000002', date '2026-03-26', 28.0, true, 450, 'Solution architecture', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000004', date '2026-03-18', 22.0, true, 180, 'Document indexing + collation', 'billed'),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000004','66666666-aaaa-0000-0000-000000000004', date '2026-03-29', 14.0, true, 180, 'Spreadsheet build', 'billed');

-- ENG-004 total = 56 + 99 = 155. Target met.

-- ============================================================
-- 4) Firm expenses (~12 rows) — last 90 days
-- ============================================================
insert into firm_expenses (tenant_id, category, vendor, description, amount, currency, expense_date, recurring, recurring_until, paid, notes) values
  -- SaaS (recurring monthly)
  ('11111111-1111-1111-1111-111111111111', 'SaaS',                  'Microsoft',         'Microsoft 365 Business Premium (15 seats)',
    3000.00, 'SAR', date '2026-04-01', 'monthly', date '2027-03-31', true, 'Annual renewal in March'),
  ('11111111-1111-1111-1111-111111111111', 'SaaS',                  'Intuit',            'QuickBooks Online — firm books',
    1200.00, 'SAR', date '2026-04-01', 'monthly', date '2027-03-31', true, null),
  ('11111111-1111-1111-1111-111111111111', 'SaaS',                  'Adobe',             'Adobe Creative Cloud — Marketing seat',
     800.00, 'SAR', date '2026-04-05', 'monthly', date '2027-03-31', true, null),

  -- Office (recurring)
  ('11111111-1111-1111-1111-111111111111', 'Office',                'Al-Khaleej Real Estate', 'Dammam HQ office rent',
    45000.00, 'SAR', date '2026-04-01', 'monthly', date '2027-03-31', true, 'King Fahd Rd HQ — 320 sqm'),
  ('11111111-1111-1111-1111-111111111111', 'Office',                'Saudi Electricity Co.', 'Utilities — April',
     3500.00, 'SAR', date '2026-04-15', 'monthly', null, true, null),
  ('11111111-1111-1111-1111-111111111111', 'Office',                'STC Business',      'Internet + IP-PBX',
     2500.00, 'SAR', date '2026-04-10', 'monthly', null, true, null),

  -- Marketing (one-time)
  ('11111111-1111-1111-1111-111111111111', 'Marketing',             'LinkedIn',          'LinkedIn Ads — Senior Auditor recruiting',
     8000.00, 'SAR', date '2026-03-12', 'one-time', null, true, 'Driven to /apply/fullscope'),

  -- Travel (one-time)
  ('11111111-1111-1111-1111-111111111111', 'Travel',                'Saudia Airlines',   'Riyadh client trip — Faisal + Layla',
     4500.00, 'SAR', date '2026-04-18', 'one-time', null, true, 'Aramco Q1 audit follow-up'),

  -- Professional Services (annual)
  ('11111111-1111-1111-1111-111111111111', 'Professional Services', 'SOCPA',             'SOCPA membership renewal — annual',
    12000.00, 'SAR', date '2026-03-30', 'annually', date '2027-03-29', true, 'Firm-level practising license'),

  -- Other
  ('11111111-1111-1111-1111-111111111111', 'Other',                 'Jarir Bookstore',   'Office supplies — printer toner + stationery',
     1800.00, 'SAR', date '2026-04-08', 'one-time', null, true, null),
  ('11111111-1111-1111-1111-111111111111', 'Other',                 'Coffee Day',        'Coffee + snacks — April',
      650.00, 'SAR', date '2026-04-02', 'monthly', null, true, null),

  -- Late-month addition (May)
  ('11111111-1111-1111-1111-111111111111', 'SaaS',                  'Microsoft',         'Microsoft 365 Business Premium (15 seats)',
    3000.00, 'SAR', date '2026-05-01', 'monthly', date '2027-03-31', true, 'May charge'),
  ('11111111-1111-1111-1111-111111111111', 'Office',                'Al-Khaleej Real Estate', 'Dammam HQ office rent — May',
    45000.00, 'SAR', date '2026-05-01', 'monthly', date '2027-03-31', true, 'May rent');
