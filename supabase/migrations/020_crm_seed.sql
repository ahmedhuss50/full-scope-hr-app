-- 020_crm_seed.sql
-- CRM module seed for Full Scope tenant. Adds 2 more KSA-flavored clients on top
-- of the 4 already seeded in 016, then layers contacts (12), deals (10), and
-- activities (~25) so the dashboard / pipeline / contact list / client detail
-- views all render meaningfully for the partner demo.
--
-- Today (per session): 2026-05-04. Dates below are anchored to that.
--
-- RUN ORDER: depends on 001..019 (CRM schema) + seed.sql + migration 016 (clients).

-- ============================================================
-- 1) Two more clients (Aramco/STC/Al-Faisal/Diriyah already exist)
-- ============================================================
insert into clients (
  id, tenant_id, name, legal_name, trade_name, industry, country_code, vat_number,
  primary_contact_name, primary_contact_email, relationship_owner_id, since, status
) values
  ('cccccccc-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
    'NEOM Tech Services',           'NEOM Tech Services Co.',         'NEOM Tech',
    'Technology',                   'SA', '300000000500003',
    'Reem Al-Otaibi',               'r.alotaibi@neom-tech.sa',
    '22222222-0000-0000-0000-000000000003', date '2025-06-12', 'active'),
  ('cccccccc-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
    'Red Sea Global Hospitality',   'Red Sea Global Hospitality LLC', 'RSG Hospitality',
    'Hospitality',                  'SA', '300000000600003',
    'Mansour Al-Harbi',             'm.alharbi@rsg-hospitality.sa',
    '22222222-0000-0000-0000-000000000003', date '2025-09-20', 'active');

-- ============================================================
-- 2) Contacts — 12 total, 2 per client
-- ============================================================
insert into crm_contacts (
  id, tenant_id, client_id, full_name, job_title, email, mobile_phone, office_phone, role, is_primary, notes
) values
  -- Aramco Services
  ('11aa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000001',
    'Khalid Al-Dosari',       'Chief Financial Officer',
    'k.aldosari@aramco-services.sa',  '+966 50 111 0011', '+966 13 880 0011',
    'finance',    true,  'Primary point of contact; prefers EN updates'),
  ('11aa1111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000001',
    'Nora Al-Ghamdi',         'Head of Internal Audit',
    'n.alghamdi@aramco-services.sa',  '+966 50 111 0012', '+966 13 880 0012',
    'technical',  false, 'Audit liaison for Q1/Q4 cycles'),

  -- Saudi Telecom Group (STC)
  ('11aa1111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000002',
    'Maha Al-Sheikh',         'Group Finance Manager',
    'm.alsheikh@stc.com.sa',          '+966 50 222 0021', '+966 11 455 0021',
    'finance',    true,  'Owns VAT and ZATCA compliance program'),
  ('11aa1111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000002',
    'Talal Bin Saad',         'Head of Procurement',
    't.binsaad@stc.com.sa',           '+966 50 222 0022', '+966 11 455 0022',
    'procurement',false, 'All SOWs route through procurement first'),

  -- Al-Faisal Holding
  ('11aa1111-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000003',
    'Abdullah Al-Faisal',     'Managing Director',
    'aalfaisal@afh-holding.sa',       '+966 50 333 0031', '+966 11 290 0031',
    'executive',  true,  'Decision-maker for advisory engagements'),
  ('11aa1111-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000003',
    'Lina Al-Mutairi',        'Group Controller',
    'l.almutairi@afh-holding.sa',     '+966 50 333 0032', '+966 11 290 0032',
    'finance',    false, 'Day-to-day finance contact'),

  -- Diriyah Construction
  ('11aa1111-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000004',
    'Saad Al-Qahtani',        'Chief Financial Officer',
    's.alqahtani@diriyah-build.sa',   '+966 50 444 0041', '+966 11 412 0041',
    'finance',    true,  'Owns ZATCA Phase 2 rollout decision'),
  ('11aa1111-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000004',
    'Hessa Al-Saif',          'Legal Counsel',
    'h.alsaif@diriyah-build.sa',      '+966 50 444 0042', '+966 11 412 0042',
    'legal',      false, 'Reviews engagement letters before signature'),

  -- NEOM Tech Services
  ('11aa1111-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000005',
    'Reem Al-Otaibi',         'Finance Director',
    'r.alotaibi@neom-tech.sa',        '+966 50 555 0051', '+966 14 333 0051',
    'finance',    true,  'Wants quarterly financial close support'),
  ('11aa1111-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000005',
    'Yazeed Al-Subaie',       'Head of IT',
    'y.alsubaie@neom-tech.sa',        '+966 50 555 0052', '+966 14 333 0052',
    'technical',  false, 'Technical contact for ZATCA e-invoicing integration'),

  -- Red Sea Global Hospitality
  ('11aa1111-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000006',
    'Mansour Al-Harbi',       'Chief Financial Officer',
    'm.alharbi@rsg-hospitality.sa',   '+966 50 666 0061', '+966 12 565 0061',
    'finance',    true,  'CFO; new relationship, friendly intro via Aramco'),
  ('11aa1111-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000006',
    'Sara Al-Zahrani',        'Procurement Manager',
    's.alzahrani@rsg-hospitality.sa', '+966 50 666 0062', '+966 12 565 0062',
    'procurement',false, 'Vendor onboarding contact');

-- ============================================================
-- 3) Deals — 10 total, distributed across stages
--    2 lead, 2 qualified, 2 proposal, 1 negotiation, 2 won, 1 lost
-- ============================================================
insert into crm_deals (
  id, tenant_id, client_id, primary_contact_id, owner_user_id, title, description,
  stage, probability, estimated_value, currency, expected_close_date, actual_close_date,
  service_type, source, lost_reason, next_step, next_step_due
) values
  -- ---------- LEAD (2) ----------
  ('22dd2222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000005', '11aa1111-0000-0000-0000-000000000009',
    '22222222-0000-0000-0000-000000000003',
    'Quarterly Close Support — NEOM Tech',
    'NEOM Finance Director asked for ongoing quarterly close + reporting package.',
    'lead', 15, 180000.00, 'SAR', date '2026-08-30', null,
    'Advisory', 'Existing Client', null,
    'Send capability deck and rates card', date '2026-05-10'),

  ('22dd2222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000006', '11aa1111-0000-0000-0000-000000000011',
    '22222222-0000-0000-0000-000000000003',
    'Hospitality Group Audit — Initial Conversation',
    'Warm intro from Khalid (Aramco). RSG considering an external audit ahead of IPO conversation.',
    'lead', 20, 320000.00, 'SAR', date '2026-09-30', null,
    'Audit', 'Referral', null,
    'Schedule discovery call with CFO Mansour', date '2026-05-12'),

  -- ---------- QUALIFIED (2) ----------
  ('22dd2222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000003', '11aa1111-0000-0000-0000-000000000005',
    '22222222-0000-0000-0000-000000000003',
    'Group Restructuring Advisory — Al-Faisal',
    'Al-Faisal looking at subsidiary consolidation. Scoped, budget confirmed at MD level.',
    'qualified', 35, 420000.00, 'SAR', date '2026-07-15', null,
    'Advisory', 'Existing Client', null,
    'Draft scoping memo + fee estimate', date '2026-05-15'),

  ('22dd2222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000005', '11aa1111-0000-0000-0000-000000000010',
    '22222222-0000-0000-0000-000000000002',
    'ZATCA Phase 2 Implementation — NEOM',
    'NEOM IT confirmed Phase 2 rollout in scope; finance + IT both bought in.',
    'qualified', 40, 145000.00, 'SAR', date '2026-06-30', null,
    'Tax', 'Existing Client', null,
    'Confirm integration partner + go/no-go meeting', date '2026-05-08'),

  -- ---------- PROPOSAL (2) ----------
  ('22dd2222-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000002', '11aa1111-0000-0000-0000-000000000003',
    '22222222-0000-0000-0000-000000000003',
    'Q3 2026 Audit Engagement — STC',
    'STC Q3 statutory audit. Proposal sent 14 days ago; awaiting procurement review.',
    'proposal', 60, 380000.00, 'SAR', date '2026-06-15', null,
    'Audit', 'Existing Client', null,
    'Follow up with procurement (Talal) for SOW status', date '2026-05-09'),

  ('22dd2222-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000004', '11aa1111-0000-0000-0000-000000000007',
    '22222222-0000-0000-0000-000000000002',
    'VAT Health-check Project — Diriyah',
    'Three-month VAT review across 8 entities. SOW v2 sent; minor pricing pushback.',
    'proposal', 55, 95000.00, 'SAR', date '2026-05-30', null,
    'Tax', 'Existing Client', null,
    'Send revised SOW with phased pricing', date '2026-05-06'),

  -- ---------- NEGOTIATION (1) ----------
  ('22dd2222-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000001', '11aa1111-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000003',
    'Q2 2026 Internal Audit Co-source — Aramco',
    'Aramco wants to co-source internal audit for 2 quarters. Final commercial terms.',
    'negotiation', 75, 520000.00, 'SAR', date '2026-05-20', null,
    'Audit', 'Existing Client', null,
    'Final pricing call with CFO Khalid', date '2026-05-07'),

  -- ---------- WON (2 — recent, last 60 days) ----------
  ('22dd2222-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000003', '11aa1111-0000-0000-0000-000000000005',
    '22222222-0000-0000-0000-000000000003',
    'Strategic Advisory Engagement — Al-Faisal',
    'Closed-won. Now live as ENG-2026-003.',
    'won', 100, 320000.00, 'SAR', date '2026-03-10', date '2026-03-10',
    'Advisory', 'Existing Client', null,
    null, null),

  ('22dd2222-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000004', '11aa1111-0000-0000-0000-000000000007',
    '22222222-0000-0000-0000-000000000002',
    'Tax Advisory + ZATCA Phase 2 Setup — Diriyah',
    'Closed-won. Now live as ENG-2026-004.',
    'won', 100, 90000.00, 'SAR', date '2026-03-01', date '2026-03-01',
    'Tax', 'Existing Client', null,
    null, null),

  -- ---------- LOST (1) ----------
  ('22dd2222-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
    'cccccccc-0000-0000-0000-000000000002', '11aa1111-0000-0000-0000-000000000003',
    '22222222-0000-0000-0000-000000000003',
    'IFRS Conversion Project — STC subsidiary',
    'Lost to Big-4 incumbent on relationship strength.',
    'lost', 0, 240000.00, 'SAR', date '2026-04-15', date '2026-04-15',
    'Advisory', 'Existing Client', 'Lost to incumbent Big-4 on relationship',
    null, null);

-- ============================================================
-- 4) Activities — ~25 entries spread across last 60 days
--    Mix: calls, emails, meetings, notes, proposals_sent, tasks (some open)
-- ============================================================
insert into crm_activities (
  tenant_id, client_id, deal_id, contact_id, actor_user_id,
  kind, subject, body, occurred_at, due_at, completed
) values
  -- Aramco (cccccccc-...001) — Q2 internal audit deal in negotiation
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
    '22dd2222-0000-0000-0000-000000000007', '11aa1111-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000003',
    'call',         'Initial discovery call — Aramco internal audit scope',
    'Discussed scope, expected timing, and team mix. Khalid wants to start by July.',
    timestamptz '2026-04-04 10:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
    '22dd2222-0000-0000-0000-000000000007', '11aa1111-0000-0000-0000-000000000002',
    '22222222-0000-0000-0000-000000000003',
    'meeting',      'Workshop with internal audit team (Nora)',
    'On-site at Dhahran. Mapped current IA footprint and gap areas.',
    timestamptz '2026-04-18 13:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
    '22dd2222-0000-0000-0000-000000000007', '11aa1111-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000003',
    'proposal_sent','Sent co-source proposal v1 — Aramco',
    'Two-quarter co-source, 1,400 hrs total, 520k SAR.',
    timestamptz '2026-04-25 09:30:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
    '22dd2222-0000-0000-0000-000000000007', '11aa1111-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000003',
    'task',         'Final pricing call with CFO Khalid',
    'Walk through revised commercial terms — staged billing milestones.',
    timestamptz '2026-05-02 09:00:00+03', timestamptz '2026-05-07 14:00:00+03', false),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
    null,                                    '11aa1111-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000003',
    'note',         'Aramco — relationship note',
    'Khalid mentioned interest in tax advisory in Q4. Park for now.',
    timestamptz '2026-04-12 16:00:00+03', null, null),

  -- STC (cccccccc-...002) — Q3 audit proposal sent + IFRS lost + tasks
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000002',
    '22dd2222-0000-0000-0000-000000000005', '11aa1111-0000-0000-0000-000000000003',
    '22222222-0000-0000-0000-000000000003',
    'meeting',      'STC Q3 audit scoping meeting',
    'Maha walked us through scope changes vs Q1. New subsidiary in scope.',
    timestamptz '2026-04-08 11:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000002',
    '22dd2222-0000-0000-0000-000000000005', '11aa1111-0000-0000-0000-000000000003',
    '22222222-0000-0000-0000-000000000003',
    'proposal_sent','Sent Q3 audit proposal to STC',
    'Proposal v1 emailed to Maha; cc Talal (procurement).',
    timestamptz '2026-04-20 15:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000002',
    '22dd2222-0000-0000-0000-000000000005', '11aa1111-0000-0000-0000-000000000004',
    '22222222-0000-0000-0000-000000000003',
    'email',        'Follow-up email — STC Q3 SOW status',
    'Asked Talal where the SOW sits in their procurement queue.',
    timestamptz '2026-04-29 10:30:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000002',
    '22dd2222-0000-0000-0000-000000000005', '11aa1111-0000-0000-0000-000000000004',
    '22222222-0000-0000-0000-000000000003',
    'task',         'Follow up with procurement (Talal) for SOW status',
    null,
    timestamptz '2026-05-02 09:00:00+03', timestamptz '2026-05-09 12:00:00+03', false),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000002',
    '22dd2222-0000-0000-0000-000000000010', '11aa1111-0000-0000-0000-000000000003',
    '22222222-0000-0000-0000-000000000003',
    'note',         'IFRS conversion deal — lost',
    'Maha confirmed they went with their existing Big-4 firm. Relationship loss, not pricing.',
    timestamptz '2026-04-15 17:00:00+03', null, null),

  -- Al-Faisal (cccccccc-...003) — restructuring qualified + advisory won
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000003',
    '22dd2222-0000-0000-0000-000000000003', '11aa1111-0000-0000-0000-000000000005',
    '22222222-0000-0000-0000-000000000003',
    'meeting',      'Coffee meeting with Abdullah Al-Faisal',
    'Al-Faisal MD signaled commitment to subsidiary restructuring this year.',
    timestamptz '2026-04-27 09:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000003',
    '22dd2222-0000-0000-0000-000000000003', '11aa1111-0000-0000-0000-000000000006',
    '22222222-0000-0000-0000-000000000003',
    'email',        'Follow-up email re: Al-Faisal advisory engagement',
    'Sent Lina (controller) the data-room access request list.',
    timestamptz '2026-04-29 14:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000003',
    '22dd2222-0000-0000-0000-000000000003', '11aa1111-0000-0000-0000-000000000005',
    '22222222-0000-0000-0000-000000000003',
    'task',         'Draft scoping memo + fee estimate — Al-Faisal restructuring',
    'Aim for 2-page memo + indicative fee bands.',
    timestamptz '2026-05-01 09:00:00+03', timestamptz '2026-05-15 17:00:00+03', false),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000003',
    '22dd2222-0000-0000-0000-000000000008', '11aa1111-0000-0000-0000-000000000005',
    '22222222-0000-0000-0000-000000000003',
    'engagement_started', 'Al-Faisal Strategic Advisory engagement started',
    'Deal won; spun up engagement ENG-2026-003.',
    timestamptz '2026-03-10 09:00:00+03', null, null),

  -- Diriyah (cccccccc-...004) — VAT health-check proposal + ZATCA won
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000004',
    '22dd2222-0000-0000-0000-000000000006', '11aa1111-0000-0000-0000-000000000007',
    '22222222-0000-0000-0000-000000000002',
    'call',         'Pricing call with Diriyah CFO Saad',
    'Saad pushed back on phase-1 fee. Agreed to send phased pricing.',
    timestamptz '2026-04-30 11:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000004',
    '22dd2222-0000-0000-0000-000000000006', '11aa1111-0000-0000-0000-000000000008',
    '22222222-0000-0000-0000-000000000002',
    'email',        'Engagement letter draft to Hessa (legal)',
    'Sent Hessa the EL draft for legal review ahead of signature.',
    timestamptz '2026-05-01 10:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000004',
    '22dd2222-0000-0000-0000-000000000006', '11aa1111-0000-0000-0000-000000000007',
    '22222222-0000-0000-0000-000000000002',
    'task',         'Send revised SOW to Diriyah (phased pricing)',
    null,
    timestamptz '2026-05-02 09:00:00+03', timestamptz '2026-05-06 17:00:00+03', false),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000004',
    '22dd2222-0000-0000-0000-000000000009', '11aa1111-0000-0000-0000-000000000007',
    '22222222-0000-0000-0000-000000000002',
    'engagement_started', 'Diriyah ZATCA Phase 2 engagement started',
    'Deal won; spun up engagement ENG-2026-004.',
    timestamptz '2026-03-01 09:00:00+03', null, null),

  -- NEOM Tech (cccccccc-...005) — quarterly close lead + ZATCA qualified
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000005',
    '22dd2222-0000-0000-0000-000000000004', '11aa1111-0000-0000-0000-000000000010',
    '22222222-0000-0000-0000-000000000002',
    'meeting',      'Demo of new ZATCA module to NEOM',
    'Walked Yazeed (IT) and Reem (Finance) through Phase 2 e-invoicing approach.',
    timestamptz '2026-05-03 14:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000005',
    '22dd2222-0000-0000-0000-000000000001', '11aa1111-0000-0000-0000-000000000009',
    '22222222-0000-0000-0000-000000000003',
    'call',         'Discovery call with NEOM Finance Director',
    'Reem asked about quarterly close support packaging. Sounded warm.',
    timestamptz '2026-04-28 10:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000005',
    '22dd2222-0000-0000-0000-000000000001', '11aa1111-0000-0000-0000-000000000009',
    '22222222-0000-0000-0000-000000000003',
    'task',         'Send NEOM capability deck and rates card',
    null,
    timestamptz '2026-05-02 09:00:00+03', timestamptz '2026-05-10 17:00:00+03', false),

  -- Red Sea Global Hospitality (cccccccc-...006) — audit lead
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000006',
    '22dd2222-0000-0000-0000-000000000002', '11aa1111-0000-0000-0000-000000000011',
    '22222222-0000-0000-0000-000000000003',
    'note',         'Warm intro from Khalid (Aramco) — RSG CFO',
    'Khalid intro''d Mansour by email; he''s open to a 30-min discovery call next week.',
    timestamptz '2026-04-22 09:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000006',
    '22dd2222-0000-0000-0000-000000000002', '11aa1111-0000-0000-0000-000000000011',
    '22222222-0000-0000-0000-000000000003',
    'email',        'Intro email to Mansour Al-Harbi (RSG CFO)',
    'Sent intro + Calendly link for a 30-min discovery call.',
    timestamptz '2026-04-24 11:00:00+03', null, null),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000006',
    '22dd2222-0000-0000-0000-000000000002', '11aa1111-0000-0000-0000-000000000011',
    '22222222-0000-0000-0000-000000000003',
    'task',         'Schedule discovery call with RSG CFO Mansour',
    null,
    timestamptz '2026-05-02 09:00:00+03', timestamptz '2026-05-12 17:00:00+03', false),

  -- A few cross-cutting "note" / "call" entries to round out activity feed
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000002',
    null,                                    null,
    '22222222-0000-0000-0000-000000000001',
    'note',         'STC — partner relationship review',
    'Quarterly check-in note. Relationship steady; opportunity in IT advisory.',
    timestamptz '2026-04-10 16:00:00+03', null, null);
