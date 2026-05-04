-- 018_dms_seed.sql
-- Seed Document Management System sample data for the Full Scope tenant.
-- KSA accounting-firm flavor: 4 client portfolios + Firm Admin / Templates / HR
-- folders. ~75 documents, ~30 access-log entries spread over the past 30 days.
--
-- RUN ORDER: depends on
--   017_dms_schema.sql
--   016_cost_tracking_seed.sql (clients + engagements seeded there)
--
-- Tenant id:           11111111-1111-1111-1111-111111111111  (Full Scope, Dammam)
-- Clients (from 016):
--   cccccccc-...001  Aramco Services
--   cccccccc-...002  Saudi Telecom Group (STC)
--   cccccccc-...003  Al-Faisal Holding
--   cccccccc-...004  Diriyah Construction
-- Users (from seed.sql):
--   22222222-...001  Ahmed (HR / Owner)
--   22222222-...002  Practice Manager
--   22222222-...003  Managing Partner
-- Engagements (from 016):
--   eeeeeeee-...001  Aramco Q1 2026 Audit
--   eeeeeeee-...002  STC VAT Compliance Q1 2026
--   eeeeeeee-...003  Al-Faisal Strategic Advisory
--   eeeeeeee-...004  Diriyah Tax + ZATCA
--   eeeeeeee-...005  Aramco Q4 2025 Audit (closed)
--   eeeeeeee-...006  STC Tax Compliance Q4 2025 (closed)

-- ============================================================
-- 1) Folders
-- ============================================================
-- UUID convention for DMS folders:
--   ddddffff-CCCC-0000-0000-NNNNNNNNNNNN
--   CCCC = client code (0001..0004) or 9000+ for firm-internal
--   N = sequence within that bucket (0001 = root, 0002..0006 = sub-folders)

-- ---------- Aramco (CCCC=0001) ----------
insert into dms_folders (id, tenant_id, parent_id, client_id, engagement_id, name, kind, description, created_by) values
  ('ddddffff-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null,
    'cccccccc-0000-0000-0000-000000000001', null,
    'Aramco Services',           'client_general', 'Root folder for Aramco Services Co.', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0001-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Engagement Letters',        'engagement',     'Signed engagement letters and renewals', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0001-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Financial Statements',      'client_general', 'Audited and management FS', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0001-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Tax Returns',               'client_general', 'ZATCA VAT and corporate income tax filings', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0001-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Working Papers',            'client_general', 'Audit workpapers and lead schedules', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0001-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Correspondence',            'client_general', 'Client correspondence and meeting notes', '22222222-0000-0000-0000-000000000003');

-- ---------- STC (CCCC=0002) ----------
insert into dms_folders (id, tenant_id, parent_id, client_id, engagement_id, name, kind, description, created_by) values
  ('ddddffff-0002-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null,
    'cccccccc-0000-0000-0000-000000000002', null,
    'Saudi Telecom Group',       'client_general', 'Root folder for STC', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0002-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000002', null,
    'Engagement Letters',        'engagement',     'Signed engagement letters and SOWs', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0002-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000002', null,
    'Financial Statements',      'client_general', 'Quarterly and annual FS', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0002-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000002', null,
    'Tax Returns',               'client_general', 'VAT returns and tax positions', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0002-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000002', null,
    'Working Papers',            'client_general', 'VAT workpapers and reconciliations', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0002-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000002', null,
    'Correspondence',            'client_general', 'Client correspondence', '22222222-0000-0000-0000-000000000003');

-- ---------- Al-Faisal Holding (CCCC=0003) ----------
insert into dms_folders (id, tenant_id, parent_id, client_id, engagement_id, name, kind, description, created_by) values
  ('ddddffff-0003-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null,
    'cccccccc-0000-0000-0000-000000000003', null,
    'Al-Faisal Holding',         'client_general', 'Root folder for Al-Faisal Holding', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0003-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Engagement Letters',        'engagement',     'Signed advisory engagement letters', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0003-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Financial Statements',      'client_general', 'Consolidated holding FS', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0003-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Tax Returns',               'client_general', 'Group tax filings', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0003-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Working Papers',            'client_general', 'Advisory workpapers and analyses', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0003-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Correspondence',            'client_general', 'Steering committee minutes and notes', '22222222-0000-0000-0000-000000000003');

-- ---------- Diriyah Construction (CCCC=0004) ----------
insert into dms_folders (id, tenant_id, parent_id, client_id, engagement_id, name, kind, description, created_by) values
  ('ddddffff-0004-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null,
    'cccccccc-0000-0000-0000-000000000004', null,
    'Diriyah Construction',      'client_general', 'Root folder for Diriyah Construction', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0004-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Engagement Letters',        'engagement',     'Signed engagement letters', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0004-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Financial Statements',      'client_general', 'Project FS and management accounts', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0004-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Tax Returns',               'client_general', 'VAT + corporate income tax', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0004-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Working Papers',            'client_general', 'ZATCA Phase 2 workpapers', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-0004-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Correspondence',            'client_general', 'Client correspondence', '22222222-0000-0000-0000-000000000003');

-- ---------- Firm-internal folders (CCCC=9001 Firm Admin, 9002 Templates, 9003 HR) ----------
insert into dms_folders (id, tenant_id, parent_id, client_id, engagement_id, name, kind, description, created_by) values
  ('ddddffff-9001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null, null,
    'Firm Admin',                'firm_admin',     'Firm licenses, leases, insurance, vendor contracts', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-9002-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null, null,
    'Templates',                 'templates',      'Reusable engagement letter / NDA / report templates', '22222222-0000-0000-0000-000000000003'),
  ('ddddffff-9003-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null, null,
    'HR',                        'hr',             'Employee handbook and policies', '22222222-0000-0000-0000-000000000003');

-- ============================================================
-- 2) Documents
-- ============================================================
-- Convention: spread uploaded_at across last ~6 months (Nov 2025..May 2026).
-- retention_until = uploaded_at + 7 years (KSA default).
-- file_size_bytes ranges roughly 100KB..5MB.

-- ---------- Aramco / Engagement Letters (3 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    'Engagement Letter — Q1 2026 Audit (signed).pdf',
    'Q1 2026 Statutory Audit — Engagement Letter',
    'Counter-signed engagement letter, Aramco Q1 2026 statutory audit',
    412350, 'application/pdf', 'engagement_letter', 'confidential', 'signed', 2,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-01-12 10:24:00+03', date '2033-01-12'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005',
    'Engagement Letter — Q4 2025 Audit (signed).pdf',
    'Q4 2025 Statutory Audit — Engagement Letter',
    'Counter-signed engagement letter, Aramco Q4 2025 audit (closed)',
    389120, 'application/pdf', 'engagement_letter', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-09-28 09:10:00+03', date '2032-09-28'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Master Service Agreement (signed).pdf',
    'Aramco Services — Master Service Agreement',
    'Master service agreement governing all engagements',
    645890, 'application/pdf', 'engagement_letter', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-11-15 14:33:00+03', date '2032-11-15');

-- ---------- Aramco / Financial Statements (3 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005',
    'Aramco Services Co - FS - 2025 (final).pdf',
    'Aramco Services Co. — Financial Statements 2025',
    'Audited financial statements for FY2025',
    1842500, 'application/pdf', 'financial_statement', 'restricted', 'final', 3,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-02-20 16:45:00+03', date '2033-02-20'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    'Aramco Services Co - Q1 2026 Management Accounts.xlsx',
    'Aramco — Q1 2026 Management Accounts',
    'Internal management accounts pack',
    524288, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'financial_statement', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-08 11:20:00+03', date '2033-04-08'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    'Aramco Services Co - FS - Q1 2026 (draft).pdf',
    'Aramco — Q1 2026 Financial Statements (Draft)',
    'Draft consolidated FS — pending partner review',
    1224400, 'application/pdf', 'financial_statement', 'restricted', 'draft', 2,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-28 17:02:00+03', date '2033-04-28');

-- ---------- Aramco / Tax Returns (3 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000001', null,
    'ZATCA Q4 2025 Return.pdf',
    'ZATCA VAT Return — Q4 2025',
    'Filed VAT return for Q4 2025 with ZATCA acknowledgement',
    268320, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-01-25 08:55:00+03', date '2033-01-25'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000001', null,
    'ZATCA Q1 2026 Return (draft).pdf',
    'ZATCA VAT Return — Q1 2026 (Draft)',
    'Draft VAT return pending client sign-off',
    241890, 'application/pdf', 'tax_return', 'restricted', 'draft', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-22 13:11:00+03', date '2033-04-22'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Corporate Income Tax 2025 (filed).pdf',
    'Corporate Income Tax — FY2025',
    'Filed corporate income tax return',
    485200, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-15 09:40:00+03', date '2033-03-15');

-- ---------- Aramco / Working Papers (4 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    'Audit Workpaper - Cash & Equivalents.xlsx',
    'Workpaper — Cash & Equivalents',
    'Lead schedule with bank confirmations and reconciliations',
    312500, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'working_paper', 'confidential', 'final', 2,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-02 10:15:00+03', date '2033-04-02'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    'Audit Workpaper - Receivables Aging.xlsx',
    'Workpaper — Receivables Aging',
    'Receivables aging analysis with confirmations follow-up',
    420000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'working_paper', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-09 15:30:00+03', date '2033-04-09'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    'Audit Workpaper - Revenue Cycle Walkthrough.docx',
    'Workpaper — Revenue Cycle Walkthrough',
    'Process walkthrough memorandum',
    188000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'working_paper', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-01 09:05:00+03', date '2033-04-01'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    'Audit Workpaper - Inventory Observation Memo.docx',
    'Workpaper — Inventory Observation',
    'Yanbu refinery inventory observation memo',
    225600, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'working_paper', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-15 18:22:00+03', date '2033-04-15');

-- ---------- Aramco / Correspondence (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Kickoff Meeting Minutes - 2026-01-15.pdf',
    'Kickoff Meeting — Minutes',
    'Minutes of audit kickoff meeting with client management',
    142800, 'application/pdf', 'other', 'internal', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-01-16 16:12:00+03', date '2033-01-16'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0001-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000001', null,
    'Management Letter - Q1 2026 (draft).pdf',
    'Management Letter — Q1 2026 (Draft)',
    'Draft management letter — internal control observations',
    203400, 'application/pdf', 'other', 'confidential', 'draft', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-30 11:48:00+03', date '2033-04-30');

-- ---------- STC / Engagement Letters (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',
    'STC VAT Compliance Engagement 2026.pdf',
    'STC — VAT Compliance Engagement 2026',
    'Counter-signed VAT compliance engagement letter, Q1 2026',
    402100, 'application/pdf', 'engagement_letter', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-01-30 10:00:00+03', date '2033-01-30'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000006',
    'STC Tax Compliance Engagement Q4 2025 (signed).pdf',
    'STC — Tax Compliance Q4 2025',
    'Closed-engagement letter, Q4 2025 tax compliance',
    378600, 'application/pdf', 'engagement_letter', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-10-05 09:30:00+03', date '2032-10-05');

-- ---------- STC / Financial Statements (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000002', null,
    'STC Group - FS - 2025 (final).pdf',
    'STC Group — Financial Statements 2025',
    'Consolidated audited financial statements',
    2148000, 'application/pdf', 'financial_statement', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-02-12 14:20:00+03', date '2033-02-12'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000002', null,
    'STC Group - Q1 2026 Trial Balance.xlsx',
    'STC — Q1 2026 Trial Balance',
    'Trial balance pull for VAT recon',
    768000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'financial_statement', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-05 13:15:00+03', date '2033-04-05');

-- ---------- STC / Tax Returns (4 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000006',
    'STC ZATCA Q4 2025 Return (filed).pdf',
    'STC — ZATCA VAT Return Q4 2025',
    'Filed VAT return with ZATCA acknowledgement',
    298400, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-01-28 11:00:00+03', date '2033-01-28'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',
    'STC ZATCA Q1 2026 Return (filed).pdf',
    'STC — ZATCA VAT Return Q1 2026',
    'Filed VAT return Q1 2026',
    312800, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-30 09:15:00+03', date '2033-04-30'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000002', null,
    'Withholding Tax Filing 2025.pdf',
    'Withholding Tax — FY2025',
    'Annual WHT filing for non-resident vendors',
    218600, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-02-26 10:45:00+03', date '2033-02-26'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000002', null,
    'STC - Corporate Income Tax 2025 (filed).pdf',
    'STC — Corporate Income Tax FY2025',
    'Filed corporate income tax return',
    458000, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-22 14:00:00+03', date '2033-03-22');

-- ---------- STC / Working Papers (3 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',
    'VAT Workpaper - Output VAT Reconciliation.xlsx',
    'Workpaper — Output VAT Reconciliation',
    'Q1 2026 output VAT recon',
    345000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'working_paper', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-09 16:00:00+03', date '2033-04-09'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',
    'VAT Workpaper - Input VAT Sampling.xlsx',
    'Workpaper — Input VAT Sampling',
    'Sample of input VAT invoices for compliance testing',
    412000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'working_paper', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-11 12:30:00+03', date '2033-04-11'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',
    'VAT Workpaper - Schedule Build.xlsx',
    'Workpaper — VAT Schedule Build',
    'Q1 2026 VAT schedule supporting return',
    525000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'working_paper', 'confidential', 'final', 2,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-15 17:45:00+03', date '2033-04-15');

-- ---------- STC / Correspondence (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000002', null,
    'STC - Q1 Review Meeting Notes.docx',
    'Q1 Review Meeting — Notes',
    'Notes from Q1 review with client tax team',
    98400, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'other', 'internal', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-23 14:30:00+03', date '2033-04-23'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0002-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000002', null,
    'ZATCA Phase 2 Briefing.pdf',
    'ZATCA Phase 2 — Client Briefing',
    'Briefing deck shared with client on Phase 2 readiness',
    1184000, 'application/pdf', 'other', 'internal', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-08 11:20:00+03', date '2033-03-08');

-- ---------- Al-Faisal / Engagement Letters (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003',
    'Al-Faisal Strategic Advisory Engagement (signed).pdf',
    'Al-Faisal — Strategic Advisory Engagement',
    'Counter-signed advisory engagement letter',
    432800, 'application/pdf', 'engagement_letter', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-08 10:30:00+03', date '2033-03-08'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000003', null,
    'NDA - Subsidiary Restructuring.pdf',
    'NDA — Subsidiary Restructuring',
    'Mutual NDA covering restructuring workstream',
    214500, 'application/pdf', 'other', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-04 09:50:00+03', date '2033-03-04');

-- ---------- Al-Faisal / Financial Statements (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Al-Faisal Holding - Consolidated FS 2025.pdf',
    'Al-Faisal Holding — Consolidated FS 2025',
    'Consolidated holding FS for FY2025',
    1925000, 'application/pdf', 'financial_statement', 'restricted', 'final', 2,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-02-28 15:10:00+03', date '2033-02-28'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003',
    'Al-Faisal - Subsidiary Performance Pack.xlsx',
    'Subsidiary Performance Pack',
    'Subsidiary-level P&L pack for advisory analysis',
    896000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'financial_statement', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-04-14 10:25:00+03', date '2033-04-14');

-- ---------- Al-Faisal / Tax Returns (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Al-Faisal Holding - Group CIT 2025.pdf',
    'Al-Faisal — Group Corporate Income Tax 2025',
    'Filed group CIT return',
    520000, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-19 11:30:00+03', date '2033-03-19'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Al-Faisal Holding - ZATCA Q1 2026.pdf',
    'Al-Faisal — ZATCA VAT Q1 2026',
    'Filed VAT return Q1 2026',
    287400, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-29 10:00:00+03', date '2033-04-29');

-- ---------- Al-Faisal / Working Papers (3 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003',
    'Advisory Workpaper - Peer Benchmarking.xlsx',
    'Workpaper — Peer Benchmarking',
    'KSA holding-company peer benchmarks',
    624000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'working_paper', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-04-10 13:40:00+03', date '2033-04-10'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003',
    'Advisory Workpaper - Subsidiary Structure Analysis.docx',
    'Workpaper — Subsidiary Structure Analysis',
    'Memo on optimal subsidiary structure',
    342000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'working_paper', 'confidential', 'final', 2,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-21 17:20:00+03', date '2033-04-21'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003',
    'Advisory Workpaper - Financial Model v3.xlsx',
    'Workpaper — Financial Model (v3)',
    '5-year integrated model — base / upside / downside',
    1450000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'working_paper', 'confidential', 'final', 3,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-04-17 16:55:00+03', date '2033-04-17');

-- ---------- Al-Faisal / Correspondence (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Steering Committee Minutes - April 2026.pdf',
    'Steering Committee — April Minutes',
    'Steering committee meeting minutes',
    154800, 'application/pdf', 'other', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-28 18:10:00+03', date '2033-04-28'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0003-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000003', null,
    'Al-Faisal - Discovery Workshop Deck.pdf',
    'Discovery Workshop — Deck',
    'Slide deck used during initial discovery workshop',
    2480000, 'application/pdf', 'other', 'internal', 'final', 1,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-04-07 12:00:00+03', date '2033-04-07');

-- ---------- Diriyah / Engagement Letters (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000004',
    'Diriyah Tax Advisory + ZATCA Engagement (signed).pdf',
    'Diriyah — Tax Advisory + ZATCA Phase 2 Engagement',
    'Counter-signed engagement letter',
    412300, 'application/pdf', 'engagement_letter', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-02-26 09:40:00+03', date '2033-02-26'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Diriyah - NDA (mutual).pdf',
    'NDA — Mutual',
    'Standard mutual NDA',
    198400, 'application/pdf', 'other', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-12-18 14:25:00+03', date '2032-12-18');

-- ---------- Diriyah / Financial Statements (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Diriyah Construction - FS 2025 (final).pdf',
    'Diriyah Construction — FS 2025',
    'Audited financial statements FY2025',
    1684000, 'application/pdf', 'financial_statement', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-02 16:00:00+03', date '2033-03-02'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Diriyah - Project Cost Pack Q1 2026.xlsx',
    'Project Cost Pack — Q1 2026',
    'Per-project cost analysis',
    742000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'financial_statement', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000002', timestamp '2026-04-12 11:50:00+03', date '2033-04-12');

-- ---------- Diriyah / Tax Returns (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Diriyah ZATCA Q4 2025 Return.pdf',
    'Diriyah — ZATCA VAT Q4 2025',
    'Filed VAT return Q4 2025',
    272000, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-01-29 10:30:00+03', date '2033-01-29'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Diriyah Corporate Income Tax 2025.pdf',
    'Diriyah — Corporate Income Tax 2025',
    'Filed CIT return',
    498000, 'application/pdf', 'tax_return', 'restricted', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-26 12:15:00+03', date '2033-03-26');

-- ---------- Diriyah / Working Papers (3 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000004',
    'ZATCA Phase 2 Readiness Assessment.pdf',
    'Workpaper — ZATCA Phase 2 Readiness Assessment',
    'Gap assessment vs. ZATCA Phase 2 e-invoicing requirements',
    684000, 'application/pdf', 'working_paper', 'confidential', 'final', 2,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-06 14:00:00+03', date '2033-04-06'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000004',
    'E-Invoicing Integration Design.docx',
    'Workpaper — E-Invoicing Integration Design',
    'Solution architecture for ZATCA Phase 2 integration',
    412000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'working_paper', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-13 17:30:00+03', date '2033-04-13'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000004',
    'VAT Mapping Spreadsheet.xlsx',
    'Workpaper — VAT Mapping',
    'Vendor + customer VAT mapping spreadsheet',
    528000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'working_paper', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-04-15 12:40:00+03', date '2033-04-15');

-- ---------- Diriyah / Correspondence (2 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Diriyah - Final Advisory Deck.pdf',
    'Final Advisory Deck',
    'Final deliverable deck shared with client',
    3120000, 'application/pdf', 'other', 'confidential', 'final', 2,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-27 16:30:00+03', date '2033-04-27'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-0004-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000004', null,
    'Diriyah - Tax Position Memorandum.pdf',
    'Tax Position Memorandum',
    'Position memo on construction-sector VAT treatment',
    312000, 'application/pdf', 'other', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-04-20 15:00:00+03', date '2033-04-20');

-- ---------- Firm Admin (5 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9001-0000-0000-000000000001', null, null,
    'SOCPA License Renewal 2026.pdf',
    'SOCPA Licence Renewal — 2026',
    'Renewed firm-level SOCPA practising licence',
    482000, 'application/pdf', 'other', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-03-30 10:00:00+03', date '2033-03-30'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9001-0000-0000-000000000001', null, null,
    'MISA Licence 2026.pdf',
    'MISA Investment Licence — 2026',
    'Ministry of Investment licence renewal',
    354000, 'application/pdf', 'other', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-02-14 09:30:00+03', date '2033-02-14'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9001-0000-0000-000000000001', null, null,
    'Office Lease - Dammam HQ (signed).pdf',
    'Office Lease — Dammam HQ',
    'Counter-signed office lease for King Fahd Rd HQ',
    824000, 'application/pdf', 'other', 'confidential', 'signed', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-11-04 11:45:00+03', date '2032-11-04'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9001-0000-0000-000000000001', null, null,
    'Professional Indemnity Insurance Policy 2026.pdf',
    'Professional Indemnity — Policy 2026',
    'PI insurance policy doc — annual renewal',
    642000, 'application/pdf', 'other', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-01-08 13:30:00+03', date '2033-01-08'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9001-0000-0000-000000000001', null, null,
    'Vendor MSA - Microsoft (signed).pdf',
    'Vendor MSA — Microsoft 365',
    'Master agreement covering Microsoft 365 firm-wide deployment',
    298000, 'application/pdf', 'other', 'internal', 'signed', 1,
    '22222222-0000-0000-0000-000000000001', timestamp '2025-12-02 15:20:00+03', date '2032-12-02');

-- ---------- Templates (6 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9002-0000-0000-000000000001', null, null,
    'Template - Engagement Letter (EN).docx',
    'Template — Engagement Letter (EN)',
    'Standard engagement letter — English version',
    142000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'engagement_letter', 'internal', 'final', 4,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-11-20 09:00:00+03', date '2032-11-20'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9002-0000-0000-000000000001', null, null,
    'Template - Engagement Letter (AR).docx',
    'Template — Engagement Letter (AR)',
    'Standard engagement letter — Arabic version',
    156000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'engagement_letter', 'internal', 'final', 4,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-11-20 09:05:00+03', date '2032-11-20'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9002-0000-0000-000000000001', null, null,
    'Template - NDA Mutual (EN).docx',
    'Template — NDA Mutual (EN)',
    'Standard mutual NDA — English',
    98000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'other', 'internal', 'final', 2,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-12-15 10:30:00+03', date '2032-12-15'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9002-0000-0000-000000000001', null, null,
    'Template - NDA Mutual (AR).docx',
    'Template — NDA Mutual (AR)',
    'Standard mutual NDA — Arabic',
    104000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'other', 'internal', 'final', 2,
    '22222222-0000-0000-0000-000000000003', timestamp '2025-12-15 10:35:00+03', date '2032-12-15'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9002-0000-0000-000000000001', null, null,
    'Template - Audit Report (EN).docx',
    'Template — Audit Report (EN)',
    'Standard unmodified audit report template',
    188000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'other', 'internal', 'final', 3,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-01-10 14:00:00+03', date '2033-01-10'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9002-0000-0000-000000000001', null, null,
    'Template - Management Letter.docx',
    'Template — Management Letter',
    'Standard management letter outline',
    124000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'other', 'internal', 'final', 1,
    '22222222-0000-0000-0000-000000000003', timestamp '2026-02-06 11:15:00+03', date '2033-02-06');

-- ---------- HR (4 docs) ----------
insert into dms_documents (
  tenant_id, folder_id, client_id, engagement_id,
  filename, display_name, description,
  file_size_bytes, mime_type, doc_kind, sensitivity, status, version_number,
  uploaded_by, uploaded_at, retention_until
) values
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9003-0000-0000-000000000001', null, null,
    'Employee Handbook 2026 (EN).pdf',
    'Employee Handbook 2026 (EN)',
    'Firm-wide employee handbook — English',
    1248000, 'application/pdf', 'other', 'internal', 'final', 3,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-01-04 10:00:00+03', date '2033-01-04'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9003-0000-0000-000000000001', null, null,
    'Employee Handbook 2026 (AR).pdf',
    'Employee Handbook 2026 (AR)',
    'Firm-wide employee handbook — Arabic',
    1284000, 'application/pdf', 'other', 'internal', 'final', 3,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-01-04 10:05:00+03', date '2033-01-04'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9003-0000-0000-000000000001', null, null,
    'Code of Conduct (EN).pdf',
    'Code of Conduct (EN)',
    'Firm-wide code of conduct — English',
    412000, 'application/pdf', 'other', 'internal', 'final', 2,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-01-04 10:10:00+03', date '2033-01-04'),
  ('11111111-1111-1111-1111-111111111111', 'ddddffff-9003-0000-0000-000000000001', null, null,
    'Code of Conduct (AR).pdf',
    'Code of Conduct (AR)',
    'Firm-wide code of conduct — Arabic',
    438000, 'application/pdf', 'other', 'internal', 'final', 2,
    '22222222-0000-0000-0000-000000000001', timestamp '2026-01-04 10:15:00+03', date '2033-01-04');

-- ============================================================
-- 3) Access log entries (~30) — last 30 days, mixed actors and actions
-- ============================================================
-- We bind to documents by filename to avoid hard-coding doc UUIDs.
-- Each entry inserts using a sub-select; using `from dms_documents where filename = ...`.

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', null, timestamp '2026-05-04 09:12:00+03'
from dms_documents d where d.filename = 'Aramco Services Co - FS - 2025 (final).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'download', 'Partner review pre-meeting', timestamp '2026-05-04 09:18:00+03'
from dms_documents d where d.filename = 'Aramco Services Co - FS - 2025 (final).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'view', null, timestamp '2026-05-03 14:45:00+03'
from dms_documents d where d.filename = 'Audit Workpaper - Cash & Equivalents.xlsx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'download', null, timestamp '2026-05-03 14:50:00+03'
from dms_documents d where d.filename = 'Audit Workpaper - Cash & Equivalents.xlsx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', null, timestamp '2026-05-03 11:22:00+03'
from dms_documents d where d.filename = 'STC ZATCA Q1 2026 Return (filed).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', 'Reviewing draft', timestamp '2026-05-02 16:08:00+03'
from dms_documents d where d.filename = 'Aramco Services Co - FS - Q1 2026 (draft).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'view', null, timestamp '2026-05-02 10:30:00+03'
from dms_documents d where d.filename = 'VAT Workpaper - Output VAT Reconciliation.xlsx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000001', 'view', null, timestamp '2026-05-01 13:55:00+03'
from dms_documents d where d.filename = 'Employee Handbook 2026 (AR).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000001', 'download', 'Sent to new joiner', timestamp '2026-05-01 14:00:00+03'
from dms_documents d where d.filename = 'Employee Handbook 2026 (AR).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', null, timestamp '2026-04-30 17:15:00+03'
from dms_documents d where d.filename = 'Engagement Letter — Q1 2026 Audit (signed).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'view', null, timestamp '2026-04-30 09:25:00+03'
from dms_documents d where d.filename = 'Diriyah - Final Advisory Deck.pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'download', null, timestamp '2026-04-29 18:40:00+03'
from dms_documents d where d.filename = 'Diriyah - Final Advisory Deck.pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'share', 'Shared with client tax lead', timestamp '2026-04-29 19:00:00+03'
from dms_documents d where d.filename = 'Diriyah - Final Advisory Deck.pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000001', 'view', null, timestamp '2026-04-28 12:00:00+03'
from dms_documents d where d.filename = 'Advisory Workpaper - Financial Model v3.xlsx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000001', 'version_upload', 'Updated to v3 with downside scenario', timestamp '2026-04-28 16:55:00+03'
from dms_documents d where d.filename = 'Advisory Workpaper - Financial Model v3.xlsx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', null, timestamp '2026-04-28 10:10:00+03'
from dms_documents d where d.filename = 'STC Group - FS - 2025 (final).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'view', null, timestamp '2026-04-27 15:30:00+03'
from dms_documents d where d.filename = 'ZATCA Phase 2 Readiness Assessment.pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'download', null, timestamp '2026-04-27 15:35:00+03'
from dms_documents d where d.filename = 'ZATCA Phase 2 Readiness Assessment.pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', null, timestamp '2026-04-26 11:00:00+03'
from dms_documents d where d.filename = 'Al-Faisal Holding - Consolidated FS 2025.pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000001', 'view', null, timestamp '2026-04-25 14:20:00+03'
from dms_documents d where d.filename = 'Template - Engagement Letter (AR).docx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000001', 'download', 'Template for new client', timestamp '2026-04-25 14:25:00+03'
from dms_documents d where d.filename = 'Template - Engagement Letter (AR).docx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', null, timestamp '2026-04-24 09:50:00+03'
from dms_documents d where d.filename = 'Corporate Income Tax 2025 (filed).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'view', null, timestamp '2026-04-22 16:00:00+03'
from dms_documents d where d.filename = 'ZATCA Q1 2026 Return (draft).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', null, timestamp '2026-04-21 17:35:00+03'
from dms_documents d where d.filename = 'Advisory Workpaper - Subsidiary Structure Analysis.docx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'version_upload', 'Updated after partner review', timestamp '2026-04-21 18:10:00+03'
from dms_documents d where d.filename = 'Advisory Workpaper - Subsidiary Structure Analysis.docx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'view', null, timestamp '2026-04-20 11:15:00+03'
from dms_documents d where d.filename = 'SOCPA License Renewal 2026.pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'view', null, timestamp '2026-04-19 10:00:00+03'
from dms_documents d where d.filename = 'Audit Workpaper - Receivables Aging.xlsx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000002', 'download', 'Field reference', timestamp '2026-04-19 10:05:00+03'
from dms_documents d where d.filename = 'Audit Workpaper - Receivables Aging.xlsx' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000003', 'share', 'Shared with PI insurer', timestamp '2026-04-18 14:30:00+03'
from dms_documents d where d.filename = 'Professional Indemnity Insurance Policy 2026.pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';

insert into dms_access_log (tenant_id, document_id, actor_user_id, action, notes, occurred_at)
select '11111111-1111-1111-1111-111111111111', d.id, '22222222-0000-0000-0000-000000000001', 'view', null, timestamp '2026-04-17 09:40:00+03'
from dms_documents d where d.filename = 'Code of Conduct (AR).pdf' and d.tenant_id = '11111111-1111-1111-1111-111111111111';
