-- 026_disbursement_workflow_seed.sql
-- Seed the Disbursement Document Review workflow template + 1 sample run
-- for the Full Scope tenant.
--
-- Today (per session): 2026-05-06.
--
-- RUN ORDER: depends on
--   025_disbursement_workflow_schema.sql (checklist + uploads tables; token_kind col)
--   024_dms_workflows_seed.sql           (existing template / runs pattern)
--   018_dms_seed.sql                     (Aramco folder we attach demo doc into)
--
-- Convention for fixed UUIDs (this migration):
--   aaaaaaaa-0000-...-001        template
--   aaaaaaaa-0000-...-011..014   template stages
--   cccc1100-...                 checklist item ids (1..19)
--   aaaa3004-...                 sample run 4 (disbursement, in-progress, stage 2 active)
--   aaaa4041..4044               run 4 steps
--   aaaa5041..5044               run 4 signers
--   aaaa6041, aaaa6042           tokens
--   aaaa8041..8042               AI analyses
--   uuuuuuuu-...                 dms_workflow_uploads
--   rrrr0001..rrrr0012           checklist responses (12 of 19 answered)
--
-- Tenant id:       11111111-1111-1111-1111-111111111111  (Full Scope, Dammam)
-- Users (existing):
--   22222222-...001  Ahmed (HR / Owner)
--   22222222-...002  Practice Manager
--   22222222-...003  Managing Partner

-- ============================================================
-- A) Template — Disbursement Document Review
-- ============================================================
insert into dms_workflow_templates (
  id, tenant_id, name, description, doc_kinds, active, created_by,
  created_at, updated_at
) values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Disbursement Document Review',
  'Multi-stage review of developer disbursement documents per Full Scope SOP. Includes 19-item compliance checklist (Arabic-primary).',
  array['disbursement','contract','bill','bank_statement'],
  true,
  '22222222-0000-0000-0000-000000000003',
  now() - interval '90 days',
  now() - interval '90 days'
);

-- ============================================================
-- B) The 4 stages (with order)
-- ============================================================
insert into dms_workflow_template_stages (
  id, tenant_id, template_id, order_index, kind, name, signer_kind,
  ai_analysis_prompt, required
) values
  ('aaaaaaaa-0000-0000-0000-000000000011',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001',
   1, 'intake', 'Developer Upload', 'external',
   'Summarize the uploaded documents (contract, bills, proof of fund, bank statement). Identify the disbursement amount, payee, project, and any obvious red flags.',
   true),
  ('aaaaaaaa-0000-0000-0000-000000000012',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001',
   2, 'internal_review', 'Admin Checklist Review', 'internal_user',
   'For each of the 19 checklist items, predict the answer (verified / issue / not_mentioned / not_attached) based on document contents and provide brief reasoning per item.',
   true),
  ('aaaaaaaa-0000-0000-0000-000000000013',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001',
   3, 'internal_review', 'Auditor Verification', 'internal_user',
   'Re-verify the admin''s 19-item checklist independently. Flag any items where your assessment differs from the admin''s.',
   true),
  ('aaaaaaaa-0000-0000-0000-000000000014',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001',
   4, 'final_approval', 'Owner Final Approval', 'internal_user',
   'Summarize the audit trail. Highlight any unresolved issues that require owner attention before final approval.',
   true);

-- ============================================================
-- C) The 19 checklist items (Arabic primary, EN parallel)
--    Bound to template-level (template_stage_id = NULL) so admin AND
--    auditor stages reuse the same items via separate response rows.
-- ============================================================
insert into dms_workflow_checklist_items (
  id, tenant_id, template_id, template_stage_id, order_index, code,
  prompt_en, prompt_ar, ai_check_capable
) values
  ('cccc1100-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 1,  'DOC_SEQUENCE',         'Verify document sequence number',                                          'التحقق من تسلسل الوثيقة',                                                              true),
  ('cccc1100-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 2,  'DOC_DATE',             'Verify document date',                                                     'التحقق من تاريخ الوثيقة',                                                              true),
  ('cccc1100-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 3,  'OPENING_BALANCE',      'Reconcile opening balances against the previous document',                'مراجعة الأرصدة الافتتاحية مع الوثيقة السابقة',                                          true),
  ('cccc1100-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 4,  'INVOICE_CLIENT',       'Verify client name on the invoice',                                       'التحقق من اسم العميل في الفاتورة',                                                     true),
  ('cccc1100-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 5,  'INVOICE_DATE',         'Verify invoice date is close to document date',                           'التحقق من تاريخ الفاتورة مقاربة لتاريخ الوثيقة',                                       true),
  ('cccc1100-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 6,  'INVOICE_NOT_PAID',     'Confirm the invoice has not been paid previously',                        'التأكد من عدم سداد الفاتورة مسبقاً',                                                   true),
  ('cccc1100-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 7,  'INVOICE_RECORDED',     'Verify invoice is recorded in the vendor and journal entries',            'مطابقة ادخال الفاتورة في كشف الموردين والقيد',                                          true),
  ('cccc1100-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 8,  'SERVICE_RECEIVED',     'Confirm service / goods receipt',                                          'التأكد من استلام الخدمة',                                                              false),
  ('cccc1100-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 9,  'CONTRACT_PRICES',      'Verify prices match the contract',                                         'التأكد من مطابقة الأسعار مع العقد',                                                    true),
  ('cccc1100-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 10, 'TOTAL_RECALC',         'Recalculate invoice totals',                                              'إعادة تجميع الفاتورة',                                                                  true),
  ('cccc1100-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 11, 'PROGRESS_PERCENT',     'Verify progress percentages match the engineering estimate',              'مراجعة صحة نسب الإنجاز في الاحتساب مع التقدير الهندسي',                              false),
  ('cccc1100-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 12, 'ACCOUNT_SUFFICIENCY',  'Verify sufficiency of construction / non-construction account',           'التحقق من كفاية الحساب الإنشائي / غير الإنشائي',                                       true),
  ('cccc1100-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 13, 'BENEFICIARY_ACCOUNT',  'Verify beneficiary account is correct',                                   'التأكد من صحة حساب المستفيد',                                                          true),
  ('cccc1100-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 14, 'GUARANTEE_ACCOUNT',    'Verify the guarantee account stated in the document is correct',          'التأكد من صحة حساب الضمان المذكور في الوثيقة',                                         true),
  ('cccc1100-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 15, 'EXPENSE_NATURE',       'Verify expense nature and the suitability of the source account',         'التحقق من طبيعة المصروف ومناسبة الحساب المصروف منه (إنشائي / غير إنشائي)',           true),
  ('cccc1100-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 16, 'TOTAL_VS_INVOICES',    'Verify the total in the disbursement document matches invoices',         'التأكد من المجموع في وثيقة الصرف مع الفواتير',                                          true),
  ('cccc1100-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 17, 'DEVELOPER_REVIEW',     'Verify developer review and approval signature matches',                 'التأكد من المراجعة والاعتماد من المطورين بمطابقة التوقيع',                              false),
  ('cccc1100-0000-0000-0000-000000000018', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 18, 'ENGINEER_APPROVAL',    'Verify engineering supervisor approval signature matches',               'التحقق من اعتماد المشرف الهندسي بمطابقة التوقيع',                                       false),
  ('cccc1100-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null, 19, 'AUTHORIZED_PAYMENT',   'Verify authorized signatories from the developer have approved payment', 'التأكد من اعتماد المفوضين من المطور باعتماد السداد',                                    false);

-- ============================================================
-- D) Sample run — Disbursement #ST0026, Madra Plot 1, 1,164,164 SAR
--    Status: in_progress, current step = 2 (Admin Checklist) — 12 of 19 answered.
-- ============================================================
do $$
declare
  v_tenant       uuid := '11111111-1111-1111-1111-111111111111';
  v_template     uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_run_id       uuid := 'aaaa3004-0000-0000-0000-000000000001';
  v_step1        uuid := 'aaaa4041-0000-0000-0000-000000000001';   -- Developer Upload
  v_step2        uuid := 'aaaa4042-0000-0000-0000-000000000001';   -- Admin Checklist
  v_step3        uuid := 'aaaa4043-0000-0000-0000-000000000001';   -- Auditor Verification
  v_step4        uuid := 'aaaa4044-0000-0000-0000-000000000001';   -- Owner Final Approval
  v_signer1      uuid := 'aaaa5041-0000-0000-0000-000000000001';   -- Hussein Al-Bagshi (developer rep)
  v_signer2      uuid := 'aaaa5042-0000-0000-0000-000000000001';   -- Ahmed Owner (admin)
  v_signer3      uuid := 'aaaa5043-0000-0000-0000-000000000001';   -- Practice Manager (auditor)
  v_signer4      uuid := 'aaaa5044-0000-0000-0000-000000000001';   -- Managing Partner (owner)
  v_doc_id       uuid;
  v_folder_id    uuid := 'ddddffff-0001-0000-0000-000000000004';   -- Aramco / Tax Returns folder (closest fit; doc kind 'disbursement')
begin
  -- 1) Create a placeholder dms_documents row representing the disbursement doc
  --    (real one would be assembled from the uploads).
  insert into dms_documents (
    id, tenant_id, folder_id, client_id, engagement_id,
    filename, display_name, description,
    doc_kind, sensitivity, status, version_number,
    uploaded_by, uploaded_at, updated_at
  ) values (
    'dddd0026-0000-0000-0000-000000000001',
    v_tenant,
    v_folder_id,
    'cccccccc-0000-0000-0000-000000000001',  -- Aramco Services (closest seeded client)
    'eeeeeeee-0000-0000-0000-000000000001',  -- Aramco Q1 2026 Audit engagement
    'ST0026-disbursement.pdf',
    'Disbursement Document #ST0026 — Madra Plot 1',
    'Construction-related disbursement bundle for Madra Plot 1, total 1,164,164 SAR.',
    'disbursement', 'confidential', 'final', 1,
    '22222222-0000-0000-0000-000000000003',
    now() - interval '2 days' - interval '4 hours',
    now() - interval '2 days' - interval '4 hours'
  )
  returning id into v_doc_id;

  -- 2) Run
  insert into dms_workflow_runs (
    id, tenant_id, template_id, document_id, client_id, engagement_id,
    initiated_by, status, current_step_id, started_at, completed_at, notes,
    created_at, updated_at
  ) values (
    v_run_id, v_tenant, v_template,
    v_doc_id,
    'cccccccc-0000-0000-0000-000000000001',
    'eeeeeeee-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000003',
    'in_progress',
    v_step2,
    now() - interval '2 days' - interval '4 hours',
    null,
    'Disbursement Document #ST0026 — Madra Plot 1, total 1,164,164 SAR. Awaiting admin checklist sign-off.',
    now() - interval '2 days' - interval '4 hours',
    now() - interval '30 minutes'
  );

  -- 3) Steps
  insert into dms_workflow_run_steps (
    id, tenant_id, run_id, template_stage_id, order_index, kind, name,
    signer_kind, status, activated_at, completed_at, rejected_reason,
    created_at, updated_at
  ) values
    (v_step1, v_tenant, v_run_id, 'aaaaaaaa-0000-0000-0000-000000000011',
     1, 'intake', 'Developer Upload', 'external',
     'approved',
     now() - interval '2 days' - interval '4 hours',
     now() - interval '2 days' - interval '2 hours',
     null,
     now() - interval '2 days' - interval '4 hours',
     now() - interval '2 days' - interval '2 hours'),
    (v_step2, v_tenant, v_run_id, 'aaaaaaaa-0000-0000-0000-000000000012',
     2, 'internal_review', 'Admin Checklist Review', 'internal_user',
     'awaiting',
     now() - interval '2 days' - interval '2 hours',
     null, null,
     now() - interval '2 days' - interval '4 hours',
     now() - interval '30 minutes'),
    (v_step3, v_tenant, v_run_id, 'aaaaaaaa-0000-0000-0000-000000000013',
     3, 'internal_review', 'Auditor Verification', 'internal_user',
     'pending', null, null, null,
     now() - interval '2 days' - interval '4 hours',
     now() - interval '2 days' - interval '4 hours'),
    (v_step4, v_tenant, v_run_id, 'aaaaaaaa-0000-0000-0000-000000000014',
     4, 'final_approval', 'Owner Final Approval', 'internal_user',
     'pending', null, null, null,
     now() - interval '2 days' - interval '4 hours',
     now() - interval '2 days' - interval '4 hours');

  -- 4) Signers
  -- Step 1 — Hussein Al-Bagshi, real-estate-developer representative (external, no account)
  insert into dms_workflow_signers (
    id, tenant_id, run_step_id, signer_kind, internal_user_id,
    external_name, external_email, external_role, notify_sent_at, created_at
  ) values
    (v_signer1, v_tenant, v_step1, 'external', null,
     'Hussein Al-Bagshi', 'h.albagshi@madra-developers.sa', 'Developer Representative',
     now() - interval '2 days' - interval '4 hours',
     now() - interval '2 days' - interval '4 hours'),
    (v_signer2, v_tenant, v_step2, 'internal_user',
     '22222222-0000-0000-0000-000000000001',
     null, null, 'Admin (Ahmed)',
     now() - interval '2 days' - interval '2 hours',
     now() - interval '2 days' - interval '4 hours'),
    (v_signer3, v_tenant, v_step3, 'internal_user',
     '22222222-0000-0000-0000-000000000002',
     null, null, 'Auditor (Practice Manager)',
     null,
     now() - interval '2 days' - interval '4 hours'),
    (v_signer4, v_tenant, v_step4, 'internal_user',
     '22222222-0000-0000-0000-000000000003',
     null, null, 'Owner (Managing Partner)',
     null,
     now() - interval '2 days' - interval '4 hours');

  -- 5) Signature for completed step 1 (developer signed off when uploads done)
  insert into dms_workflow_signatures (
    tenant_id, run_step_id, signer_id, decision, reason,
    signer_ip, signer_user_agent, signed_at
  ) values (
    v_tenant, v_step1, v_signer1, 'approve',
    'All four documents uploaded. Disbursement bundle complete for review.',
    '94.108.55.18', 'Mozilla/5.0 (Windows)',
    now() - interval '2 days' - interval '2 hours'
  );

  -- 6) Tokens
  -- Token A: the USED upload token from 2 days ago
  insert into dms_workflow_signer_tokens (
    id, tenant_id, signer_id, token, expires_at, used_at, view_count, created_at, token_kind
  ) values (
    'aaaa6041-0000-0000-0000-000000000001', v_tenant, v_signer1,
    'demoupload26disbursement00usedtoken99001',
    now() + interval '5 days',
    now() - interval '2 days' - interval '2 hours',
    3,
    now() - interval '2 days' - interval '4 hours',
    'upload'
  );
  -- Token B: a STILL-ACTIVE upload token for the demo (so the user can show
  -- the upload page UI in incognito). Same signer, regenerated for demo only.
  insert into dms_workflow_signer_tokens (
    id, tenant_id, signer_id, token, expires_at, used_at, view_count, created_at, token_kind
  ) values (
    'aaaa6042-0000-0000-0000-000000000001', v_tenant, v_signer1,
    'demoupload26disbursement01developertoken',
    now() + interval '7 days',
    null,
    0,
    now() - interval '30 minutes',
    'upload'
  );

  -- 7) Uploads (4 files attached by the developer)
  insert into dms_workflow_uploads (
    id, tenant_id, run_id, run_step_id, uploaded_by_signer_id,
    filename, display_name, upload_kind, storage_path, storage_bucket,
    file_size_bytes, mime_type, uploaded_at
  ) values
    ('aaaa1100-0000-0000-0000-000000000001', v_tenant, v_run_id, v_step1, v_signer1,
     'Madra-Plot1-Construction-Contract-2026.pdf',
     'Construction Contract — Madra Plot 1',
     'contract',
     v_tenant::text || '/' || v_run_id::text || '/contract/Madra-Plot1-Construction-Contract-2026.pdf',
     'Document submission',
     2_842_115, 'application/pdf',
     now() - interval '2 days' - interval '3 hours' - interval '20 minutes'),
    ('aaaa1100-0000-0000-0000-000000000002', v_tenant, v_run_id, v_step1, v_signer1,
     'INV-ST0026-MadraPlot1.pdf',
     'Bill / Invoice ST0026',
     'bill',
     v_tenant::text || '/' || v_run_id::text || '/bill/INV-ST0026-MadraPlot1.pdf',
     'Document submission',
     481_902, 'application/pdf',
     now() - interval '2 days' - interval '3 hours' - interval '5 minutes'),
    ('aaaa1100-0000-0000-0000-000000000003', v_tenant, v_run_id, v_step1, v_signer1,
     'Proof-of-Fund-AlRajhi-MadraPlot1.pdf',
     'Proof of Fund — Al Rajhi Bank',
     'proof_of_fund',
     v_tenant::text || '/' || v_run_id::text || '/proof_of_fund/Proof-of-Fund-AlRajhi-MadraPlot1.pdf',
     'Document submission',
     224_580, 'application/pdf',
     now() - interval '2 days' - interval '2 hours' - interval '40 minutes'),
    ('aaaa1100-0000-0000-0000-000000000004', v_tenant, v_run_id, v_step1, v_signer1,
     'Bank-Statement-AlRajhi-Q1-2026.pdf',
     'Bank Statement — Al Rajhi Q1 2026',
     'bank_statement',
     v_tenant::text || '/' || v_run_id::text || '/bank_statement/Bank-Statement-AlRajhi-Q1-2026.pdf',
     'Document submission',
     1_204_336, 'application/pdf',
     now() - interval '2 days' - interval '2 hours' - interval '15 minutes');

  -- 8) AI analyses
  -- Stage 1 — developer upload summary
  insert into dms_workflow_ai_analyses (
    id, tenant_id, run_id, run_step_id, prompt, model,
    summary, key_points, risk_flags, recommendation, confidence,
    raw_output, generated_at
  ) values (
    'aaaa8041-0000-0000-0000-000000000001', v_tenant, v_run_id, v_step1,
    'Summarize the uploaded documents (contract, bills, proof of fund, bank statement). Identify the disbursement amount, payee, project, and any obvious red flags.',
    'mock',
    'Uploaded 4 documents totalling 1,164,164 SAR. Disbursement #ST0026. Payee: Al-Sahel Construction Co. Project: Madra Plot 1. Construction-related expense. No obvious anomalies in initial review.',
    array[
      'Bundle: contract + bill + proof of fund + bank statement.',
      'Disbursement #ST0026 — total 1,164,164 SAR.',
      'Payee: Al-Sahel Construction Co.',
      'Project: Madra Plot 1 (construction account).',
      'Bank statement opening balance: 5,732,914 SAR (Al Rajhi).',
      'No duplicate-payment or amount-mismatch flags surfaced.'
    ],
    array[]::text[],
    'Recommend route to Admin Checklist Review (Stage 2).',
    0.93,
    '{"mock":true,"branch":"disbursement:intake"}'::jsonb,
    now() - interval '2 days' - interval '2 hours' - interval '5 minutes'
  );

  -- Stage 2 — admin checklist pre-fill summary
  insert into dms_workflow_ai_analyses (
    id, tenant_id, run_id, run_step_id, prompt, model,
    summary, key_points, risk_flags, recommendation, confidence,
    raw_output, generated_at
  ) values (
    'aaaa8042-0000-0000-0000-000000000001', v_tenant, v_run_id, v_step2,
    'For each of the 19 checklist items, predict the answer (verified / issue / not_mentioned / not_attached) based on document contents and provide brief reasoning per item.',
    'mock',
    'Pre-filled 14 of 19 checklist items based on document contents. Flagged 5 items where supporting documentation is missing or not mentioned. Recommend admin verify items 5, 7, 17, 18, 19 manually before signing off.',
    array[
      '14/19 items pre-filled with confidence ≥ 0.80.',
      '5 items require human verification (signatures, recording in vendor ledger, invoice-date proximity).',
      'Construction account has sufficient balance (5,732,914 SAR vs 1,164,164 SAR draw).',
      'Beneficiary account matches contract.',
      'Total in disbursement document reconciles to invoice within 0.0%.'
    ],
    array['signatures_unverified','vendor_ledger_unconfirmed'],
    'Recommend admin review items 5, 7, 17, 18, 19 manually before sign-off.',
    0.87,
    '{"mock":true,"branch":"disbursement:admin_checklist"}'::jsonb,
    now() - interval '2 days' - interval '2 hours'
  );

  -- 9) Checklist responses — first 12 of 19 answered by admin (5 flagged demo-realism)
  --    Items 1-12 have responses; items 13-19 are still pending (no row yet, they fall back
  --    to AI suggested when displayed). For items where the admin has answered:
  --      items 2, 5, 7 → not_mentioned / not_attached (matches the original screenshot pattern)
  --      item 12 → notes "1,164,164" (matches the highlighted balance)
  --    All responses below carry an AI-suggested status + confidence so the UI can compare.
  insert into dms_workflow_checklist_responses (
    id, tenant_id, run_step_id, checklist_item_id,
    status, notes,
    ai_suggested_status, ai_suggested_notes, ai_confidence,
    responded_by, responded_at
  ) values
    -- 1. DOC_SEQUENCE — verified
    ('bbbb0001-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000001',
     'verified', 'Sequence ST0026 follows ST0025 (prior disbursement on same project).',
     'verified', 'Sequence ST0026 detected; prior ST0025 referenced.', 0.96,
     '22222222-0000-0000-0000-000000000001', now() - interval '90 minutes'),
    -- 2. DOC_DATE — not_mentioned
    ('bbbb0002-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000002',
     'not_mentioned', 'Document carries no explicit issue date — only a footer print date.',
     'not_mentioned', 'No explicit issue date in document body; footer print date only.', 0.78,
     '22222222-0000-0000-0000-000000000001', now() - interval '88 minutes'),
    -- 3. OPENING_BALANCE — verified
    ('bbbb0003-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000003',
     'verified', 'Opening balance 5,732,914 SAR ties to ST0025 closing.',
     'verified', 'Opening balance reconciles to prior document closing.', 0.91,
     '22222222-0000-0000-0000-000000000001', now() - interval '85 minutes'),
    -- 4. INVOICE_CLIENT — verified
    ('bbbb0004-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000004',
     'verified', 'Invoice billed to Madra Developers (project owner).',
     'verified', 'Client name on invoice: Madra Developers.', 0.94,
     '22222222-0000-0000-0000-000000000001', now() - interval '80 minutes'),
    -- 5. INVOICE_DATE — not_mentioned (admin disagreed with AI which had verified)
    ('bbbb0005-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000005',
     'not_mentioned', 'Invoice date is hand-written and partly illegible. Treat as not mentioned pending clarification.',
     'verified', 'Invoice dated within 14 days of disbursement document.', 0.62,
     '22222222-0000-0000-0000-000000000001', now() - interval '76 minutes'),
    -- 6. INVOICE_NOT_PAID — verified
    ('bbbb0006-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000006',
     'verified', 'No prior payment found against this invoice number in vendor ledger.',
     'verified', 'No prior payment record located for invoice number.', 0.88,
     '22222222-0000-0000-0000-000000000001', now() - interval '72 minutes'),
    -- 7. INVOICE_RECORDED — not_attached
    ('bbbb0007-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000007',
     'not_attached', 'Vendor ledger snapshot was not attached. Requesting from developer.',
     'not_attached', 'Vendor ledger snapshot not present in upload bundle.', 0.84,
     '22222222-0000-0000-0000-000000000001', now() - interval '68 minutes'),
    -- 8. SERVICE_RECEIVED — verified
    ('bbbb0008-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000008',
     'verified', 'Site engineer confirmed receipt of milestone deliverable.',
     null, null, null,
     '22222222-0000-0000-0000-000000000001', now() - interval '60 minutes'),
    -- 9. CONTRACT_PRICES — verified
    ('bbbb0009-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000009',
     'verified', 'Unit prices on invoice match Section 4 of the contract.',
     'verified', 'Invoice unit prices align with contract pricing schedule.', 0.95,
     '22222222-0000-0000-0000-000000000001', now() - interval '55 minutes'),
    -- 10. TOTAL_RECALC — verified
    ('bbbb0010-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000010',
     'verified', 'Recomputed line totals = 1,164,164 SAR. Matches header.',
     'verified', 'Line-item recomputation matches stated total: 1,164,164 SAR.', 0.99,
     '22222222-0000-0000-0000-000000000001', now() - interval '50 minutes'),
    -- 11. PROGRESS_PERCENT — issue (admin flagged a discrepancy)
    ('bbbb0011-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000011',
     'issue', 'Invoice claims 32% progress; engineering estimate cites 28%. 4-pt gap to reconcile.',
     'pending', 'Engineering estimate not attached; cannot verify automatically.', 0.55,
     '22222222-0000-0000-0000-000000000001', now() - interval '42 minutes'),
    -- 12. ACCOUNT_SUFFICIENCY — verified, with notes "1,164,164"
    ('bbbb0012-0000-0000-0000-000000000001', v_tenant, v_step2, 'cccc1100-0000-0000-0000-000000000012',
     'verified', '1,164,164',
     'verified', 'Construction account balance 5,732,914 SAR — sufficient for draw of 1,164,164 SAR.', 0.97,
     '22222222-0000-0000-0000-000000000001', now() - interval '35 minutes');

  -- Items 13-19 intentionally have NO response row yet (still pending for the admin).

  -- 10) Audit log entries (~10 events)
  insert into dms_workflow_audit_log (
    tenant_id, run_id, run_step_id, actor_kind, actor_user_id, actor_signer_id,
    action, details, ip_address, occurred_at
  ) values
    (v_tenant, v_run_id, null, 'user',
     '22222222-0000-0000-0000-000000000003', null,
     'workflow_started', '{"template":"Disbursement Document Review"}'::jsonb,
     '10.0.0.43', now() - interval '2 days' - interval '4 hours'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'step_activated', '{"order_index":1,"name":"Developer Upload","signer":"Hussein Al-Bagshi"}'::jsonb,
     null, now() - interval '2 days' - interval '4 hours'),
    (v_tenant, v_run_id, v_step1, 'system', null, v_signer1,
     'token_created', '{"expires_in_days":7,"kind":"upload"}'::jsonb,
     null, now() - interval '2 days' - interval '4 hours'),
    (v_tenant, v_run_id, v_step1, 'system', null, v_signer1,
     'email_sent', '{"channel":"resend","to":"h.albagshi@madra-developers.sa","subject":"Upload requested: Disbursement #ST0026"}'::jsonb,
     null, now() - interval '2 days' - interval '4 hours'),
    (v_tenant, v_run_id, v_step1, 'external_signer', null, v_signer1,
     'signer_viewed', '{"view_count":1}'::jsonb,
     '94.108.55.18', now() - interval '2 days' - interval '3 hours' - interval '40 minutes'),
    (v_tenant, v_run_id, v_step1, 'external_signer', null, v_signer1,
     'upload_received', '{"kind":"contract","filename":"Madra-Plot1-Construction-Contract-2026.pdf","size":2842115}'::jsonb,
     '94.108.55.18', now() - interval '2 days' - interval '3 hours' - interval '20 minutes'),
    (v_tenant, v_run_id, v_step1, 'external_signer', null, v_signer1,
     'upload_received', '{"kind":"bill","filename":"INV-ST0026-MadraPlot1.pdf","size":481902}'::jsonb,
     '94.108.55.18', now() - interval '2 days' - interval '3 hours' - interval '5 minutes'),
    (v_tenant, v_run_id, v_step1, 'external_signer', null, v_signer1,
     'upload_received', '{"kind":"proof_of_fund","filename":"Proof-of-Fund-AlRajhi-MadraPlot1.pdf","size":224580}'::jsonb,
     '94.108.55.18', now() - interval '2 days' - interval '2 hours' - interval '40 minutes'),
    (v_tenant, v_run_id, v_step1, 'external_signer', null, v_signer1,
     'upload_received', '{"kind":"bank_statement","filename":"Bank-Statement-AlRajhi-Q1-2026.pdf","size":1204336}'::jsonb,
     '94.108.55.18', now() - interval '2 days' - interval '2 hours' - interval '15 minutes'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'ai_analysis_generated', '{"model":"mock","confidence":0.93,"step":"intake"}'::jsonb,
     null, now() - interval '2 days' - interval '2 hours' - interval '5 minutes'),
    (v_tenant, v_run_id, v_step1, 'external_signer', null, v_signer1,
     'signer_approved', '{"step":"intake","reason":"All four documents uploaded."}'::jsonb,
     '94.108.55.18', now() - interval '2 days' - interval '2 hours'),
    (v_tenant, v_run_id, v_step2, 'system', null, null,
     'step_activated', '{"order_index":2,"name":"Admin Checklist Review"}'::jsonb,
     null, now() - interval '2 days' - interval '2 hours'),
    (v_tenant, v_run_id, v_step2, 'system', null, null,
     'ai_analysis_generated', '{"model":"mock","confidence":0.87,"step":"admin_checklist","prefilled":14}'::jsonb,
     null, now() - interval '2 days' - interval '2 hours'),
    (v_tenant, v_run_id, v_step2, 'user',
     '22222222-0000-0000-0000-000000000001', null,
     'checklist_progress', '{"answered":12,"of":19,"step":"admin_checklist"}'::jsonb,
     '10.0.0.41', now() - interval '35 minutes');
end $$;
