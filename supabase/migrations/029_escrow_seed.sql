-- 029_escrow_seed.sql
-- ============================================================================
-- ESCROW CONTROL MODULE — seed data
-- ============================================================================
-- Creates one fully-wired dummy project ("Madra Plot 2") for Talaat Mostafa
-- Group, with:
--   - 3 segregated escrow accounts (construction / non-construction / preservation)
--   - 3 authorized signers (with signing limits)
--   - 5 suppliers (4 approved repeat-suppliers + 1 new pending-approval)
--   - 4 contracts with line items (so rule #3 price-match has data to check)
--   - 3 buyers with unit-purchase contracts
--   - 1 completion certificate (for rule #8 extract-vs-cert demos)
--
-- Today (per session): 2026-05-19.
--
-- RUN ORDER: 028_escrow_schema.sql.
--
-- Convention for fixed UUIDs (this migration):
--   eeee0001-...                 developer
--   eeee0002-...                 project (Madra Plot 2)
--   eeee0011..0013               escrow accounts (3 types)
--   eeee0021..0023               authorized signers
--   eeee0031..0035               suppliers
--   eeee0041..0044               contracts
--   eeee0051..0072               contract line items
--   eeee0081..0083               buyers
--   eeee0091                     completion certificate
--
-- Tenant id:    11111111-1111-1111-1111-111111111111  (Full Scope, Dammam)
-- Owner user:   22222222-0000-0000-0000-000000000003
-- ============================================================================

-- ============================================================
-- A) Developer
-- ============================================================
insert into escrow_developers (
  id, tenant_id, name_en, name_ar, cr_number, vat_number,
  contact_email, contact_phone, status, notes,
  created_at, updated_at
) values (
  'eeee0001-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Talaat Mostafa Group — KSA',
  'مجموعة طلعت مصطفى — السعودية',
  '1010ABCDEF',
  '300012345600003',
  'finance@tmg-ksa.example.com',
  '+966500000001',
  'active',
  'Sample developer for escrow demo. Replace with real entity before production.',
  now() - interval '180 days',
  now() - interval '180 days'
) on conflict (id) do nothing;

-- ============================================================
-- B) Project — Madra Plot 2
-- ============================================================
insert into escrow_projects (
  id, tenant_id, developer_id, code, name_en, name_ar,
  description, location_en, location_ar,
  status, start_date, expected_completion_date, total_budget_sar,
  notes, created_at, updated_at
) values (
  'eeee0002-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'eeee0001-0000-0000-0000-000000000001',
  'ST0027',
  'Madra — Plot 2',
  'مدرا — قطعة 2',
  'Mixed-use residential tower, 14 floors, 84 units.',
  'Al-Khobar, Eastern Province',
  'الخبر، المنطقة الشرقية',
  'active',
  date '2026-01-15',
  date '2027-12-31',
  85000000.00,
  'Sample project for escrow audit pilot.',
  now() - interval '120 days',
  now() - interval '120 days'
) on conflict (id) do nothing;

-- ============================================================
-- C) Escrow accounts — 3 per project
-- ============================================================
insert into escrow_accounts (
  id, tenant_id, project_id, account_type,
  bank_name, iban, account_number,
  opening_balance_sar, current_balance_sar, last_balance_at,
  notes, created_at, updated_at
) values
  ('eeee0011-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'construction',
   'Saudi National Bank',
   'SA0010000000000000000001',
   '00000000000001',
   12000000.00, 7350000.00, now() - interval '1 day',
   'Receives 76% of every buyer deposit. Funds construction extracts only.',
   now() - interval '110 days', now() - interval '1 day'),
  ('eeee0012-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'non_construction',
   'Saudi National Bank',
   'SA0010000000000000000002',
   '00000000000002',
   3000000.00, 1820000.00, now() - interval '1 day',
   'Receives 20% of every buyer deposit. Funds admin, marketing, security.',
   now() - interval '110 days', now() - interval '1 day'),
  ('eeee0013-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'preservation',
   'Saudi National Bank',
   'SA0010000000000000000003',
   '00000000000003',
   600000.00, 600000.00, now() - interval '1 day',
   'Receives 4% of every buyer deposit. Holdback per regulation; rarely drawn.',
   now() - interval '110 days', now() - interval '1 day')
on conflict (project_id, account_type) do nothing;

-- ============================================================
-- D) Authorized signers (rule #11)
-- ============================================================
insert into escrow_authorized_signers (
  id, tenant_id, developer_id, name, title, email, phone,
  signing_limit_sar, effective_from, status, notes,
  created_at, updated_at
) values
  ('eeee0021-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0001-0000-0000-0000-000000000001',
   'Ahmad Al-Saud', 'Chief Financial Officer',
   'ahmad.saud@tmg-ksa.example.com', '+966500000011',
   10000000.00, date '2026-01-01', 'active',
   'Highest signing limit. Required for vouchers > 2M SAR.',
   now() - interval '120 days', now() - interval '120 days'),
  ('eeee0022-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0001-0000-0000-0000-000000000001',
   'Khalid Al-Rashid', 'Finance Director',
   'khalid.rashid@tmg-ksa.example.com', '+966500000012',
   2000000.00, date '2026-01-01', 'active',
   'Mid-tier signer.',
   now() - interval '120 days', now() - interval '120 days'),
  ('eeee0023-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0001-0000-0000-0000-000000000001',
   'Sara Al-Otaibi', 'Treasury Manager',
   'sara.otaibi@tmg-ksa.example.com', '+966500000013',
   500000.00, date '2026-01-01', 'active',
   'Routine vouchers up to 500K SAR.',
   now() - interval '120 days', now() - interval '120 days')
on conflict (id) do nothing;

-- ============================================================
-- E) Suppliers (5: 4 approved repeat-suppliers, 1 pending-approval new vendor)
-- ============================================================
insert into escrow_suppliers (
  id, tenant_id, name_en, name_ar, cr_number, vat_number,
  bank_name, bank_account_number, iban,
  contact_email, contact_phone,
  status, first_seen_at, approval_count, approved_at, approved_by_user_id,
  notes, created_at, updated_at
) values
  ('eeee0031-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'Al-Sahel Construction Co.', 'شركة الساحل للمقاولات',
   '2050987654', '300098765400003',
   'Al Rajhi Bank', '60000000000001', 'SA0080000000000000000031',
   'ar@alsahel.example.com', '+966500000031',
   'approved', now() - interval '180 days', 7,
   now() - interval '170 days', '22222222-0000-0000-0000-000000000003',
   'Main contractor for Madra Plot 2. Repeat supplier.',
   now() - interval '180 days', now() - interval '1 day'),
  ('eeee0032-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'Khalid Security Services', 'خالد للحراسات الأمنية',
   '2050111222', '300011122200003',
   'Riyad Bank', '40000000000002', 'SA0020000000000000000032',
   'ops@khalidsecurity.example.com', '+966500000032',
   'approved', now() - interval '160 days', 5,
   now() - interval '150 days', '22222222-0000-0000-0000-000000000003',
   'Site security guard service. Non-construction expense.',
   now() - interval '160 days', now() - interval '5 days'),
  ('eeee0033-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'Riyadh Marketing Group', 'مجموعة الرياض للتسويق',
   '1010333444', '300033344400003',
   'Saudi National Bank', '10000000000003', 'SA0010000000000000000033',
   'accounts@riyadhmarketing.example.com', '+966500000033',
   'approved', now() - interval '120 days', 3,
   now() - interval '110 days', '22222222-0000-0000-0000-000000000003',
   'Sales & marketing campaign for unit pre-sales. Non-construction.',
   now() - interval '120 days', now() - interval '10 days'),
  ('eeee0034-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'Najran Building Materials', 'نجران لمواد البناء',
   '5050555666', '300055566600003',
   'Bank Albilad', '70000000000004', 'SA0090000000000000000034',
   'sales@najranbuilding.example.com', '+966500000034',
   'approved', now() - interval '90 days', 4,
   now() - interval '80 days', '22222222-0000-0000-0000-000000000003',
   'Cement, rebar, and bulk material supplier. Construction expense.',
   now() - interval '90 days', now() - interval '7 days'),
  ('eeee0035-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'New Vendor Co.', 'شركة المورد الجديد',
   '1010777888', '300077788800003',
   'Alinma Bank', '20000000000005', 'SA0050000000000000000035',
   'info@newvendor.example.com', '+966500000035',
   'pending_approval', now() - interval '3 days', 0,
   null, null,
   'First-time supplier. Voucher will trigger manual approval flow per UX rule.',
   now() - interval '3 days', now() - interval '3 days')
on conflict (id) do nothing;

-- ============================================================
-- F) Contracts (4) — supplier ↔ project ↔ agreed prices
-- ============================================================
insert into escrow_contracts (
  id, tenant_id, project_id, supplier_id,
  contract_number, contract_date, total_value_sar, currency, expense_nature,
  status, notes, created_at, updated_at
) values
  -- C1: Al-Sahel main construction contract
  ('eeee0041-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'eeee0031-0000-0000-0000-000000000001',
   'CON-MP2-001', date '2026-01-20', 45000000.00, 'SAR', 'construction',
   'active', 'Main civil works for Madra Plot 2.',
   now() - interval '120 days', now() - interval '120 days'),
  -- C2: Khalid Security monthly service
  ('eeee0042-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'eeee0032-0000-0000-0000-000000000001',
   'SEC-MP2-001', date '2026-02-01', 720000.00, 'SAR', 'non_construction',
   'active', '60K SAR / month x 12 months. Site security.',
   now() - interval '110 days', now() - interval '110 days'),
  -- C3: Riyadh Marketing campaign
  ('eeee0043-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'eeee0033-0000-0000-0000-000000000001',
   'MKT-MP2-001', date '2026-02-15', 300000.00, 'SAR', 'non_construction',
   'active', 'Pre-sales campaign, 3 months.',
   now() - interval '95 days', now() - interval '95 days'),
  -- C4: Najran Building Materials (cement supply)
  ('eeee0044-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'eeee0034-0000-0000-0000-000000000001',
   'MAT-MP2-001', date '2026-03-01', 850000.00, 'SAR', 'construction',
   'active', 'Cement & rebar supply contract.',
   now() - interval '80 days', now() - interval '80 days')
on conflict (id) do nothing;

-- ============================================================
-- G) Contract line items — agreed unit prices for rule #3
-- ============================================================
insert into escrow_contract_line_items (
  id, tenant_id, contract_id, order_index,
  item_description, item_description_ar,
  unit_of_measure, agreed_unit_price_sar, quantity_estimated,
  notes, created_at
) values
  -- C1 lines (Al-Sahel)
  ('eeee0051-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0041-0000-0000-0000-000000000001', 1,
   'Excavation & earthworks', 'حفر وأعمال ترابية',
   'm3', 85.0000, 12000, null, now() - interval '120 days'),
  ('eeee0052-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0041-0000-0000-0000-000000000001', 2,
   'Reinforced concrete works', 'أعمال الخرسانة المسلحة',
   'm3', 1450.0000, 6500, null, now() - interval '120 days'),
  ('eeee0053-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0041-0000-0000-0000-000000000001', 3,
   'Block work & masonry', 'أعمال البلوك والبناء',
   'm2', 120.0000, 18000, null, now() - interval '120 days'),
  ('eeee0054-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0041-0000-0000-0000-000000000001', 4,
   'Plastering — internal', 'أعمال اللياسة الداخلية',
   'm2', 45.0000, 35000, null, now() - interval '120 days'),
  ('eeee0055-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0041-0000-0000-0000-000000000001', 5,
   'Tiling — flooring', 'أعمال البلاط',
   'm2', 165.0000, 9000, null, now() - interval '120 days'),
  -- C2 lines (Khalid Security)
  ('eeee0061-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0042-0000-0000-0000-000000000001', 1,
   'Security guard — daytime shift (12 hr)', 'حارس أمن — وردية نهارية',
   'month', 30000.0000, 12, null, now() - interval '110 days'),
  ('eeee0062-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0042-0000-0000-0000-000000000001', 2,
   'Security guard — night shift (12 hr)', 'حارس أمن — وردية ليلية',
   'month', 30000.0000, 12, null, now() - interval '110 days'),
  -- C3 lines (Riyadh Marketing)
  ('eeee0063-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0043-0000-0000-0000-000000000001', 1,
   'Digital ads — Google / Meta', 'إعلانات رقمية',
   'month', 60000.0000, 3, null, now() - interval '95 days'),
  ('eeee0064-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0043-0000-0000-0000-000000000001', 2,
   'Outdoor billboards — King Fahd Rd', 'لوحات إعلانية خارجية',
   'month', 40000.0000, 3, null, now() - interval '95 days'),
  -- C4 lines (Najran Materials)
  ('eeee0071-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0044-0000-0000-0000-000000000001', 1,
   'Portland cement type I — 50 kg bag', 'إسمنت بورتلاندي نوع 1 — كيس 50 كجم',
   'bag', 22.5000, 25000, null, now() - interval '80 days'),
  ('eeee0072-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeee0044-0000-0000-0000-000000000001', 2,
   'Steel rebar — 12mm', 'حديد تسليح — 12 مم',
   'ton', 2800.0000, 110, null, now() - interval '80 days')
on conflict (id) do nothing;

-- ============================================================
-- H) Buyers — 3 buyers with unit-purchase contracts
-- ============================================================
insert into escrow_buyers (
  id, tenant_id, project_id, full_name, national_id_or_iqama,
  contact_email, contact_phone,
  unit_code, unit_description, total_unit_price_sar, total_paid_sar,
  payment_schedule, status, notes,
  created_at, updated_at
) values
  ('eeee0081-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'Faisal Al-Harbi', '1012345678',
   'faisal.harbi@example.com', '+966500000081',
   'A-101', '2-bedroom apartment, floor 1, 110 m²',
   1200000.00, 480000.00,
   '[
     {"due_date":"2026-02-01","amount":240000,"note":"Down payment"},
     {"due_date":"2026-05-01","amount":240000,"note":"Foundation milestone"},
     {"due_date":"2026-09-01","amount":360000,"note":"Structure milestone"},
     {"due_date":"2027-06-01","amount":360000,"note":"Handover"}
   ]'::jsonb,
   'active', null,
   now() - interval '100 days', now() - interval '15 days'),
  ('eeee0082-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'Noura Al-Qahtani', '1023456789',
   'noura.qahtani@example.com', '+966500000082',
   'A-102', '2-bedroom apartment, floor 1, 125 m²',
   1350000.00, 270000.00,
   '[
     {"due_date":"2026-03-01","amount":270000,"note":"Down payment"},
     {"due_date":"2026-07-01","amount":270000,"note":"Foundation milestone"},
     {"due_date":"2026-12-01","amount":405000,"note":"Structure milestone"},
     {"due_date":"2027-08-01","amount":405000,"note":"Handover"}
   ]'::jsonb,
   'active', null,
   now() - interval '80 days', now() - interval '20 days'),
  ('eeee0083-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'eeee0002-0000-0000-0000-000000000001',
   'Mansour Al-Dosari', '1034567890',
   'mansour.dosari@example.com', '+966500000083',
   'B-203', '3-bedroom apartment, floor 2, 160 m²',
   1800000.00, 0.00,
   '[
     {"due_date":"2026-06-01","amount":360000,"note":"Down payment"},
     {"due_date":"2026-10-01","amount":360000,"note":"Foundation milestone"},
     {"due_date":"2027-03-01","amount":540000,"note":"Structure milestone"},
     {"due_date":"2027-11-01","amount":540000,"note":"Handover"}
   ]'::jsonb,
   'active', 'Signed; first payment not yet due.',
   now() - interval '40 days', now() - interval '40 days')
on conflict (id) do nothing;

-- ============================================================
-- I) Completion certificate — for rule #8 (extract-vs-cert)
-- ============================================================
insert into escrow_completion_certificates (
  id, tenant_id, project_id, contract_id,
  certificate_number, issued_date, completion_pct,
  issued_by_name, issued_by_title, storage_path, notes,
  created_at
) values (
  'eeee0091-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'eeee0002-0000-0000-0000-000000000001',
  'eeee0041-0000-0000-0000-000000000001',
  'CERT-MP2-005', date '2026-05-05', 50.00,
  'Eng. Mohammed Al-Shehri', 'Engineering Supervisor',
  null,
  'Site inspection on 2026-05-05. Civil works at 50% of contract scope.',
  now() - interval '14 days'
) on conflict (id) do nothing;
