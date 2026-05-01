-- seed.sql — Full Scope tenant seed for the Full-Scope-HR-Platform Phase 1 scaffold.
--
-- This is the default initial seed: a single accounting firm in Dammam, Saudi Arabia,
-- bilingual AR/EN, defaulting to Arabic (KSA-primary).
-- Run AFTER all migrations 001–012.
-- Encrypted columns use placeholder bytes; replace with pgsodium calls in real use.

-- ----- Tenant -----
insert into tenants (id, name, slug, subdomain, locale_default) values
  ('11111111-1111-1111-1111-111111111111', 'Full Scope', 'fullscope', 'fullscope', 'ar');

insert into firm_settings (
  tenant_id, brand_primary_hex, brand_logo_url, support_email,
  enable_sms, enable_whatsapp, enable_qbo, enable_xero, enable_sage,
  default_locale, fiscal_year_start_month, default_currency, vat_pct, gcc_country_code
) values (
  '11111111-1111-1111-1111-111111111111', '0D9488', null, 'support@elevatemybusiness.co',
  true, true, true, true, false,
  'ar', 1, 'SAR', 15.0, 'SA'
);

-- ----- Users (placeholder rows — replace with real Supabase Auth users) -----
-- The app matches Supabase Auth users to this `users` table by email.
-- Invite each one through Supabase → Authentication → Users → Add user.
insert into users (id, tenant_id, email, full_name, phone, locale) values
  ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'support@elevatemybusiness.co', 'Ahmed — HR / Owner (Full Scope)',                       '+966 13 000 0001', 'en'),
  ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'pm@fullscope.sa',      'Practice Manager — Full Scope (placeholder)',           '+966 13 000 0002', 'ar'),
  ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'partner@fullscope.sa', 'Managing Partner — Full Scope (placeholder)',           '+966 13 000 0003', 'ar');

insert into user_roles (user_id, role_key) values
  ('22222222-0000-0000-0000-000000000001', 'hr'),
  ('22222222-0000-0000-0000-000000000002', 'practice_manager'),
  ('22222222-0000-0000-0000-000000000003', 'managing_partner'),
  ('22222222-0000-0000-0000-000000000003', 'admin');

-- ----- Reference data -----
insert into departments (id, tenant_id, name) values
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Assurance'),
  ('33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tax Services'),
  ('33333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Advisory'),
  ('33333333-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Business Development'),
  ('33333333-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Office / Admin');

insert into work_locations (id, tenant_id, name, address_line_1, city, emirate_or_region, country_code, postal_code) values
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Dammam HQ', 'King Fahd Rd', 'Dammam', 'Eastern Province', 'SA', '31411');

insert into practice_areas (id, tenant_id, code, name, description) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'audit',         'Audit & Assurance',     'External audit, review, agreed-upon procedures'),
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'tax',           'Tax Services',          'ZATCA VAT, corporate tax, transfer pricing'),
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'advisory',      'Advisory',              'CFO services, M&A, transformation'),
  ('55555555-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'bd',            'Business Development',  'Pipeline, proposals, partnerships'),
  ('55555555-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consultation',  'Consultation',          'Ad-hoc consultation engagements'),
  ('55555555-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'admin',         'Administration',        'Office management, HR, finance ops');

-- ----- Open job requisitions -----
insert into job_requisitions (id, tenant_id, title, department_id, practice_area_id, work_location_id, pay_type, pay_rate_min, pay_rate_max, pay_currency, classification, status, openings_count, created_by) values
  ('66666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tax Accountant',
    '33333333-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002',
    '44444444-0000-0000-0000-000000000001',
    'Salary',  9000.00, 14000.00, 'SAR', 'W-2', 'open', 1, '22222222-0000-0000-0000-000000000001'),
  ('66666666-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Senior Auditor',
    '33333333-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
    '44444444-0000-0000-0000-000000000001',
    'Salary', 14000.00, 22000.00, 'SAR', 'W-2', 'open', 2, '22222222-0000-0000-0000-000000000001'),
  ('66666666-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Office Admin',
    '33333333-0000-0000-0000-000000000005', '55555555-0000-0000-0000-000000000006',
    '44444444-0000-0000-0000-000000000001',
    'Salary',  5000.00,  7500.00, 'SAR', 'W-2', 'open', 1, '22222222-0000-0000-0000-000000000001');

-- ----- Sample candidates (realistic Saudi / Egyptian / Indian names) -----
insert into candidates (
  id, tenant_id, legal_first_name, legal_last_name, primary_email, mobile_phone,
  home_country_code, home_city, work_auth_status, classification_preference, source, locale,
  cpa_track, licenses_held, jurisdictions, years_experience, audit_hours, primary_practice_area
) values
  -- Saudi national, SOCPA + CPA — Senior Auditor candidate, AR-primary
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'Faisal',  'Al-Otaibi',   'faisal.alotaibi@example.com', '+966551110201',
    'SA', 'Dammam', 'GCC National', 'W-2', 'referral', 'ar',
    true,  '{SOCPA,CPA}', '{KSA,GCC}',  9, 6800, 'audit'),
  -- Egyptian, EA (US tax) — Tax Accountant candidate, EN-primary
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'Yusuf',   'Ibrahim',     'yusuf.ibrahim@example.com',   '+966551110202',
    'EG', 'Khobar', 'Work Visa Sponsored', 'W-2', 'linkedin', 'en',
    false, '{EA,IFRS}',   '{KSA,Egypt}', 5,  900, 'tax'),
  -- Indian, ACCA-track — Tax Accountant candidate, EN-primary
  ('77777777-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'Priya',   'Menon',       'priya.menon@example.com',     '+966551110203',
    'IN', 'Dammam', 'Work Visa Sponsored', 'W-2', 'bayt', 'en',
    true,  '{ACCA}',      '{KSA,India}', 3,  450, 'tax');

-- ----- Applications (mix of statuses) -----
insert into applications (id, tenant_id, candidate_id, job_requisition_id, status, applied_at) values
  -- Faisal: Senior Auditor, status interview_scheduled
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    '77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000002',
    'interview_scheduled', now() - interval '4 days'),
  -- Yusuf: Tax Accountant, status in_review
  ('88888888-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    '77777777-0000-0000-0000-000000000002', '66666666-0000-0000-0000-000000000001',
    'in_review',           now() - interval '1 days'),
  -- Priya: Tax Accountant, status applied (just came in)
  ('88888888-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    '77777777-0000-0000-0000-000000000003', '66666666-0000-0000-0000-000000000001',
    'applied',             now() - interval '4 hours');

-- ----- Interview already scheduled for Faisal -----
insert into interviews (id, tenant_id, application_id, interviewer_user_id, interview_type, scheduled_start, scheduled_end, status, location_id) values
  ('99999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    '88888888-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002',
    'in_person', now() + interval '2 days' + interval '9 hours',
                 now() + interval '2 days' + interval '10 hours',
    'scheduled', '44444444-0000-0000-0000-000000000001');

insert into interview_slots (tenant_id, interview_id, slot_start, slot_end, selected) values
  ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001', now() + interval '2 days' + interval '9 hours',  now() + interval '2 days' + interval '10 hours', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001', now() + interval '2 days' + interval '14 hours', now() + interval '2 days' + interval '15 hours', false),
  ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001', now() + interval '3 days' + interval '10 hours', now() + interval '3 days' + interval '11 hours', false);

-- ----- Application status history (so the candidate detail page shows transitions) -----
insert into application_status_history (application_id, tenant_id, from_status, to_status, actor_user_id, reason_code) values
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'applied',           'interview_pending',   '22222222-0000-0000-0000-000000000001', 'will_interview'),
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'interview_pending', 'interview_scheduled', null,                                   'candidate_picked_slot'),
  ('88888888-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'applied',           'in_review',           '22222222-0000-0000-0000-000000000001', 'screening');

-- ----- Seeded translations (starter set; locale = en/ar) -----
insert into translations (tenant_id, key, en, ar) values
  (null, 'app.welcome',                   'Welcome',                     'مرحبا'),
  (null, 'form.legal_first_name',         'Legal First Name',            'الاسم القانوني الأول'),
  (null, 'form.legal_last_name',          'Legal Last Name',             'الاسم القانوني الأخير'),
  (null, 'form.mobile_phone',             'Mobile Phone',                'الهاتف المحمول'),
  (null, 'form.primary_email',            'Email',                       'البريد الإلكتروني'),
  (null, 'form.resume_upload',            'Upload Resume',               'تحميل السيرة الذاتية'),
  (null, 'form.classification_w2',        'Full Employee',               'موظف بدوام كامل'),
  (null, 'form.classification_1099',      'Independent Contractor',      'متعاقد مستقل'),
  (null, 'form.work_auth.gcc_national',   'GCC National',                'مواطن خليجي'),
  (null, 'form.work_auth.gcc_resident',   'GCC Resident',                'مقيم في دول الخليج'),
  (null, 'form.work_auth.visa',           'Work Visa Sponsored',         'تأشيرة عمل برعاية'),
  (null, 'interview.email.proposed',      'Pick an interview time',      'اختر موعد المقابلة'),
  (null, 'status.applied',                'Applied',                     'تم التقديم'),
  (null, 'status.in_review',              'In Review',                   'قيد المراجعة'),
  (null, 'status.interview_scheduled',    'Interview Scheduled',         'تم تحديد موعد المقابلة'),
  (null, 'status.hired',                  'Hired',                       'تم التوظيف'),
  (null, 'status.rejected',               'Not Selected',                'لم يتم الاختيار'),
  (null, 'practice.audit',                'Audit & Assurance',           'التدقيق والتأمين'),
  (null, 'practice.tax',                  'Tax Services',                'الخدمات الضريبية'),
  (null, 'practice.advisory',             'Advisory',                    'الاستشارات'),
  (null, 'practice.bd',                   'Business Development',        'تطوير الأعمال'),
  (null, 'practice.consultation',         'Consultation',                'الاستشارات الموجّهة'),
  (null, 'practice.admin',                'Administration',              'الإدارة');
