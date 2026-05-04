-- 024_dms_workflows_seed.sql
-- Seed Document Workflow data for the Full Scope tenant.
-- 1 reusable template (4 stages) + 3 sample runs (in_progress / completed / rejected).
--
-- Today (per session): 2026-05-04. Dates anchored relative to that.
--
-- RUN ORDER: depends on
--   001..023 (workflow schema) + 016 (clients/engagements) + 018 (DMS docs) +
--   020 (CRM contacts).

-- ============================================================
-- 0) Convention for fixed UUIDs
--    aaaa1111-...    workflow templates
--    aaaa2222-...    template stages
--    aaaa3001-...    workflow run 1   (in_progress, Aramco)
--    aaaa3002-...    workflow run 2   (completed,  STC)
--    aaaa3003-...    workflow run 3   (rejected,   Diriyah)
--    aaaa4xxx-...    run steps        (xxx = run-3-digit + step-1-digit, e.g., 4011 = run1 step1)
--    aaaa5xxx-...    signers
--    aaaa6xxx-...    signer tokens
--    aaaa7xxx-...    signatures
--    aaaa8xxx-...    AI analyses
-- ============================================================

-- ============================================================
-- 1) Template — Engagement Letter Approval (4 stages)
-- ============================================================
insert into dms_workflow_templates (
  id, tenant_id, name, description, doc_kinds, active, created_by,
  created_at, updated_at
) values (
  'aaaa1111-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Engagement Letter Approval',
  'Standard 4-stage approval pipeline for client engagement letters: intake, client signature, internal review, final partner approval.',
  array['engagement_letter'],
  true,
  '22222222-0000-0000-0000-000000000003',
  now() - interval '120 days',
  now() - interval '120 days'
);

insert into dms_workflow_template_stages (
  id, tenant_id, template_id, order_index, kind, name, signer_kind,
  ai_analysis_prompt, required
) values
  ('aaaa2222-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-0000-0000-0000-000000000001',
   1, 'intake', 'Intake review', 'internal_user',
   'Summarise the engagement scope, fee, period, and any non-standard clauses. Recommend next action.',
   true),
  ('aaaa2222-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-0000-0000-0000-000000000001',
   2, 'client_signature', 'Client signature', 'external',
   'Summarise the engagement letter for the client signer in plain language. Highlight scope, fee, payment terms, and any clauses that warrant attention. Recommend a decision.',
   true),
  ('aaaa2222-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-0000-0000-0000-000000000001',
   3, 'internal_review', 'Internal review', 'internal_user',
   'Compare working papers and trial balance to ensure consistency. Flag any reconciliation gaps or numerical discrepancies.',
   true),
  ('aaaa2222-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-0000-0000-0000-000000000001',
   4, 'final_approval', 'Final approval', 'internal_user',
   'Final partner sign-off. Confirm SOCPA compliance and acceptance for filing.',
   true);

-- ============================================================
-- 2) RUN 1 — In progress, awaiting client signature (Aramco engagement letter)
-- ============================================================
-- Document: pick the most recent Aramco engagement letter in folder
-- ddddffff-0001-0000-0000-000000000002 (Aramco / Engagement Letters).
-- We use a DO block to bind the document_id without requiring a stable
-- UUID in 018 seed.
do $$
declare
  v_doc_id uuid;
  v_engagement_id uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_client_id uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_tenant uuid := '11111111-1111-1111-1111-111111111111';
  v_run_id uuid := 'aaaa3001-0000-0000-0000-000000000001';
  v_step1 uuid := 'aaaa4011-0000-0000-0000-000000000001';
  v_step2 uuid := 'aaaa4012-0000-0000-0000-000000000001';
  v_step3 uuid := 'aaaa4013-0000-0000-0000-000000000001';
  v_step4 uuid := 'aaaa4014-0000-0000-0000-000000000001';
  v_signer1 uuid := 'aaaa5011-0000-0000-0000-000000000001';
  v_signer2 uuid := 'aaaa5012-0000-0000-0000-000000000001';
  v_signer3 uuid := 'aaaa5013-0000-0000-0000-000000000001';
  v_signer4 uuid := 'aaaa5014-0000-0000-0000-000000000001';
begin
  select id into v_doc_id
  from dms_documents
  where tenant_id = v_tenant
    and folder_id = 'ddddffff-0001-0000-0000-000000000002'
    and doc_kind = 'engagement_letter'
    and engagement_id = v_engagement_id
  order by uploaded_at desc
  limit 1;

  -- Fallback: any Aramco doc
  if v_doc_id is null then
    select id into v_doc_id from dms_documents
    where tenant_id = v_tenant and client_id = v_client_id
    order by uploaded_at desc limit 1;
  end if;

  -- Run
  insert into dms_workflow_runs (
    id, tenant_id, template_id, document_id, client_id, engagement_id,
    initiated_by, status, current_step_id, started_at, completed_at, notes,
    created_at, updated_at
  ) values (
    v_run_id, v_tenant,
    'aaaa1111-0000-0000-0000-000000000001',
    v_doc_id, v_client_id, v_engagement_id,
    '22222222-0000-0000-0000-000000000001',  -- Ahmed (HR / Owner) initiated
    'awaiting_signer',
    v_step2,
    now() - interval '1 day' - interval '6 hours',
    null,
    'Q2 2026 audit engagement — awaiting Aramco CFO signature.',
    now() - interval '1 day' - interval '6 hours',
    now() - interval '2 hours'
  );

  -- Steps
  insert into dms_workflow_run_steps (
    id, tenant_id, run_id, template_stage_id, order_index, kind, name,
    signer_kind, status, activated_at, completed_at, rejected_reason,
    created_at, updated_at
  ) values
    (v_step1, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000001',
     1, 'intake', 'Intake review', 'internal_user',
     'approved',
     now() - interval '1 day' - interval '6 hours',
     now() - interval '1 day' - interval '4 hours',
     null,
     now() - interval '1 day' - interval '6 hours',
     now() - interval '1 day' - interval '4 hours'),
    (v_step2, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000002',
     2, 'client_signature', 'Client signature', 'external',
     'awaiting',
     now() - interval '1 day' - interval '4 hours',
     null, null,
     now() - interval '1 day' - interval '6 hours',
     now() - interval '2 hours'),
    (v_step3, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000003',
     3, 'internal_review', 'Internal review', 'internal_user',
     'pending', null, null, null,
     now() - interval '1 day' - interval '6 hours',
     now() - interval '1 day' - interval '6 hours'),
    (v_step4, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000004',
     4, 'final_approval', 'Final approval', 'internal_user',
     'pending', null, null, null,
     now() - interval '1 day' - interval '6 hours',
     now() - interval '1 day' - interval '6 hours');

  -- Signers
  -- Step 1 — Ahmed (intake) approved already
  insert into dms_workflow_signers (
    id, tenant_id, run_step_id, signer_kind, internal_user_id,
    external_name, external_email, external_role, notify_sent_at, created_at
  ) values (
    v_signer1, v_tenant, v_step1, 'internal_user',
    '22222222-0000-0000-0000-000000000001',
    null, null, 'Owner / Operations',
    now() - interval '1 day' - interval '6 hours',
    now() - interval '1 day' - interval '6 hours'
  );

  -- Step 2 — Khalid Al-Dosari, Aramco CFO (external)
  insert into dms_workflow_signers (
    id, tenant_id, run_step_id, signer_kind, internal_user_id,
    external_name, external_email, external_role, notify_sent_at, created_at
  ) values (
    v_signer2, v_tenant, v_step2, 'external', null,
    'Khalid Al-Dosari', 'k.aldosari@aramco-services.sa', 'Aramco CFO',
    now() - interval '2 hours',
    now() - interval '1 day' - interval '4 hours'
  );

  -- Step 3 — Faisal Bin Hamad, Tax Manager (internal review)
  insert into dms_workflow_signers (
    id, tenant_id, run_step_id, signer_kind, internal_user_id,
    external_name, external_email, external_role, notify_sent_at, created_at
  ) values (
    v_signer3, v_tenant, v_step3, 'internal_user',
    '22222222-0000-0000-0000-000000000002',
    null, null, 'Practice Manager',
    null,
    now() - interval '1 day' - interval '6 hours'
  );

  -- Step 4 — Managing Partner (final approval)
  insert into dms_workflow_signers (
    id, tenant_id, run_step_id, signer_kind, internal_user_id,
    external_name, external_email, external_role, notify_sent_at, created_at
  ) values (
    v_signer4, v_tenant, v_step4, 'internal_user',
    '22222222-0000-0000-0000-000000000003',
    null, null, 'Managing Partner',
    null,
    now() - interval '1 day' - interval '6 hours'
  );

  -- Signature for completed step 1
  insert into dms_workflow_signatures (
    tenant_id, run_step_id, signer_id, decision, reason,
    signer_ip, signer_user_agent, signed_at
  ) values (
    v_tenant, v_step1, v_signer1, 'approve',
    'Engagement scope and fee match the proposal. Ready for client signature.',
    '10.0.0.41', 'Mozilla/5.0 (Macintosh)',
    now() - interval '1 day' - interval '4 hours'
  );

  -- Token for Step 2 (the demo URL — fixed 40-char token for the demo)
  insert into dms_workflow_signer_tokens (
    id, tenant_id, signer_id, token, expires_at, used_at, view_count, created_at
  ) values (
    'aaaa6011-0000-0000-0000-000000000001', v_tenant, v_signer2,
    'demo20260504aramcokhalidsignerlinktoken1',  -- 40 chars, URL-safe, deterministic for the demo
    now() + interval '7 days', null, 0,
    now() - interval '2 hours'
  );

  -- AI analyses
  -- Step 1 — internal intake analysis
  insert into dms_workflow_ai_analyses (
    id, tenant_id, run_id, run_step_id, prompt, model,
    summary, key_points, risk_flags, recommendation, confidence,
    raw_output, generated_at
  ) values (
    'aaaa8011-0000-0000-0000-000000000001', v_tenant, v_run_id, v_step1,
    'Summarise the engagement scope, fee, period, and any non-standard clauses. Recommend next action.',
    'mock',
    'Q2 2026 statutory audit engagement letter for Aramco Services Co. — 480,000 SAR fee over 4 months under SOCPA / ISA framework.',
    array[
      'Scope: full statutory audit per Saudi ISA standards for the period 1 Apr 2026 – 30 Jun 2026.',
      'Fee: 480,000 SAR fixed, billed in 4 monthly installments of 120,000 SAR.',
      'Liability cap set at 3x fee (1,440,000 SAR) — within firm policy.',
      'Standard SOCPA-compliant termination + IP clauses.',
      'Counter-signature required from Aramco CFO before fieldwork begins.'
    ],
    array[]::text[],
    'Recommend approve and route to client signature.',
    0.94,
    '{"mock":true,"branch":"engagement_letter:intake"}'::jsonb,
    now() - interval '1 day' - interval '5 hours' - interval '30 minutes'
  );

  -- Step 2 — external client signer analysis
  insert into dms_workflow_ai_analyses (
    id, tenant_id, run_id, run_step_id, prompt, model,
    summary, key_points, risk_flags, recommendation, confidence,
    raw_output, generated_at
  ) values (
    'aaaa8012-0000-0000-0000-000000000001', v_tenant, v_run_id, v_step2,
    'Summarise the engagement letter for the client signer in plain language.',
    'mock',
    'Aramco is committing to engage Full Scope as statutory auditor for Q2 2026 at a fixed fee of 480,000 SAR.',
    array[
      'Engagement period: 1 April 2026 to 30 June 2026.',
      'Fixed fee of 480,000 SAR, billed monthly in 4 equal installments.',
      'SOCPA and ISA standards apply throughout the engagement.',
      'Standard liability cap of 3x fee. No unusual clauses identified.',
      'Auditor independence and confidentiality terms align with industry norms.'
    ],
    array[]::text[],
    'No red flags identified. Safe to approve.',
    0.92,
    '{"mock":true,"branch":"engagement_letter:client_signature"}'::jsonb,
    now() - interval '2 hours' - interval '5 minutes'
  );

  -- Audit log entries (10 events for run 1)
  insert into dms_workflow_audit_log (
    tenant_id, run_id, run_step_id, actor_kind, actor_user_id, actor_signer_id,
    action, details, ip_address, occurred_at
  ) values
    (v_tenant, v_run_id, null, 'user',
     '22222222-0000-0000-0000-000000000001', null,
     'workflow_started',
     '{"template":"Engagement Letter Approval"}'::jsonb,
     '10.0.0.41', now() - interval '1 day' - interval '6 hours'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'step_activated', '{"order_index":1,"name":"Intake review"}'::jsonb,
     null, now() - interval '1 day' - interval '6 hours'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'ai_analysis_generated',
     '{"model":"mock","confidence":0.94,"step":"intake"}'::jsonb,
     null, now() - interval '1 day' - interval '5 hours' - interval '30 minutes'),
    (v_tenant, v_run_id, v_step1, 'user',
     '22222222-0000-0000-0000-000000000001', null,
     'signer_approved',
     '{"step":"intake","reason":"Scope and fee match proposal."}'::jsonb,
     '10.0.0.41', now() - interval '1 day' - interval '4 hours'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'step_completed', '{"order_index":1}'::jsonb,
     null, now() - interval '1 day' - interval '4 hours'),
    (v_tenant, v_run_id, v_step2, 'system', null, null,
     'step_activated',
     '{"order_index":2,"name":"Client signature","signer":"Khalid Al-Dosari"}'::jsonb,
     null, now() - interval '1 day' - interval '4 hours'),
    (v_tenant, v_run_id, v_step2, 'system', null, v_signer2,
     'signer_invited',
     '{"email":"k.aldosari@aramco-services.sa","role":"Aramco CFO"}'::jsonb,
     null, now() - interval '2 hours' - interval '10 minutes'),
    (v_tenant, v_run_id, v_step2, 'system', null, v_signer2,
     'token_created',
     '{"expires_in_days":7}'::jsonb,
     null, now() - interval '2 hours' - interval '5 minutes'),
    (v_tenant, v_run_id, v_step2, 'system', null, null,
     'ai_analysis_generated',
     '{"model":"mock","confidence":0.92,"step":"client_signature"}'::jsonb,
     null, now() - interval '2 hours' - interval '5 minutes'),
    (v_tenant, v_run_id, v_step2, 'system', null, v_signer2,
     'email_sent',
     '{"channel":"resend","to":"k.aldosari@aramco-services.sa","subject":"Approval requested: Q2 2026 Audit Engagement Letter"}'::jsonb,
     null, now() - interval '2 hours');
end $$;

-- ============================================================
-- 3) RUN 2 — Completed (STC tax return, 5 days ago)
-- ============================================================
do $$
declare
  v_doc_id uuid;
  v_tenant uuid := '11111111-1111-1111-1111-111111111111';
  v_client_id uuid := 'cccccccc-0000-0000-0000-000000000002';
  v_engagement_id uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  v_run_id uuid := 'aaaa3002-0000-0000-0000-000000000001';
  v_step1 uuid := 'aaaa4021-0000-0000-0000-000000000001';
  v_step2 uuid := 'aaaa4022-0000-0000-0000-000000000001';
  v_step3 uuid := 'aaaa4023-0000-0000-0000-000000000001';
  v_step4 uuid := 'aaaa4024-0000-0000-0000-000000000001';
  v_signer1 uuid := 'aaaa5021-0000-0000-0000-000000000001';
  v_signer2 uuid := 'aaaa5022-0000-0000-0000-000000000001';
  v_signer3 uuid := 'aaaa5023-0000-0000-0000-000000000001';
  v_signer4 uuid := 'aaaa5024-0000-0000-0000-000000000001';
begin
  select id into v_doc_id
  from dms_documents
  where tenant_id = v_tenant
    and folder_id = 'ddddffff-0002-0000-0000-000000000004'
    and doc_kind = 'tax_return'
  order by uploaded_at desc
  limit 1;

  if v_doc_id is null then
    select id into v_doc_id from dms_documents
    where tenant_id = v_tenant and client_id = v_client_id
    order by uploaded_at desc limit 1;
  end if;

  -- Run
  insert into dms_workflow_runs (
    id, tenant_id, template_id, document_id, client_id, engagement_id,
    initiated_by, status, current_step_id, started_at, completed_at, notes,
    created_at, updated_at
  ) values (
    v_run_id, v_tenant,
    'aaaa1111-0000-0000-0000-000000000001',
    v_doc_id, v_client_id, v_engagement_id,
    '22222222-0000-0000-0000-000000000003',
    'completed',
    v_step4,
    now() - interval '12 days',
    now() - interval '5 days',
    'STC ZATCA Q1 2026 VAT return — fully approved and filed.',
    now() - interval '12 days',
    now() - interval '5 days'
  );

  -- Steps (all approved)
  insert into dms_workflow_run_steps (
    id, tenant_id, run_id, template_stage_id, order_index, kind, name,
    signer_kind, status, activated_at, completed_at, rejected_reason,
    created_at, updated_at
  ) values
    (v_step1, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000001',
     1, 'intake', 'Intake review', 'internal_user',
     'approved',
     now() - interval '12 days', now() - interval '11 days', null,
     now() - interval '12 days', now() - interval '11 days'),
    (v_step2, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000002',
     2, 'client_signature', 'Client signature', 'external',
     'approved',
     now() - interval '11 days', now() - interval '8 days', null,
     now() - interval '12 days', now() - interval '8 days'),
    (v_step3, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000003',
     3, 'internal_review', 'Internal review', 'internal_user',
     'approved',
     now() - interval '8 days', now() - interval '6 days', null,
     now() - interval '12 days', now() - interval '6 days'),
    (v_step4, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000004',
     4, 'final_approval', 'Final approval', 'internal_user',
     'approved',
     now() - interval '6 days', now() - interval '5 days', null,
     now() - interval '12 days', now() - interval '5 days');

  -- Signers
  insert into dms_workflow_signers (
    id, tenant_id, run_step_id, signer_kind, internal_user_id,
    external_name, external_email, external_role, notify_sent_at, created_at
  ) values
    (v_signer1, v_tenant, v_step1, 'internal_user',
     '22222222-0000-0000-0000-000000000001',
     null, null, 'Operations',
     now() - interval '12 days',
     now() - interval '12 days'),
    (v_signer2, v_tenant, v_step2, 'external', null,
     'Maha Al-Sheikh', 'm.alsheikh@stc.com.sa', 'STC Group VAT Director',
     now() - interval '11 days',
     now() - interval '11 days'),
    (v_signer3, v_tenant, v_step3, 'internal_user',
     '22222222-0000-0000-0000-000000000002',
     null, null, 'Practice Manager',
     now() - interval '8 days',
     now() - interval '8 days'),
    (v_signer4, v_tenant, v_step4, 'internal_user',
     '22222222-0000-0000-0000-000000000003',
     null, null, 'Managing Partner',
     now() - interval '6 days',
     now() - interval '6 days');

  -- Signatures
  insert into dms_workflow_signatures (
    tenant_id, run_step_id, signer_id, decision, reason,
    signer_ip, signer_user_agent, signed_at
  ) values
    (v_tenant, v_step1, v_signer1, 'approve',
     'Workpapers cross-foot to filed return. Ready for client.',
     '10.0.0.41', 'Mozilla/5.0 (Macintosh)',
     now() - interval '11 days'),
    (v_tenant, v_step2, v_signer2, 'approve',
     'Numbers reconcile to STC ledger. Approved for filing.',
     '85.222.10.14', 'Mozilla/5.0 (Windows)',
     now() - interval '8 days'),
    (v_tenant, v_step3, v_signer3, 'approve',
     'Independent review complete; no exceptions.',
     '10.0.0.42', 'Mozilla/5.0 (Macintosh)',
     now() - interval '6 days'),
    (v_tenant, v_step4, v_signer4, 'approve',
     'Final partner sign-off. Filed with ZATCA.',
     '10.0.0.43', 'Mozilla/5.0 (Macintosh)',
     now() - interval '5 days');

  -- AI analyses (one per step, light)
  insert into dms_workflow_ai_analyses (
    tenant_id, run_id, run_step_id, prompt, model,
    summary, key_points, risk_flags, recommendation, confidence,
    raw_output, generated_at
  ) values
    (v_tenant, v_run_id, v_step1, null, 'mock',
     'STC Q1 2026 VAT return totalling 84.2M SAR output VAT, 73.1M SAR input VAT, net 11.1M SAR payable.',
     array[
       'Output VAT 84,210,400 SAR matches schedule build.',
       'Input VAT 73,094,200 SAR ties to vendor invoices sampled.',
       'Net payable 11,116,200 SAR aligns with STC trial balance.',
       'Filing deadline: 30 April 2026 (met).'
     ],
     array[]::text[],
     'Recommend approve. Numbers consistent with workpapers.',
     0.96, null,
     now() - interval '11 days' - interval '4 hours'),
    (v_tenant, v_run_id, v_step2, null, 'mock',
     'VAT return for STC Group covering Q1 2026. Net VAT payable: 11.1M SAR.',
     array[
       'Filing covers 1 Jan – 31 Mar 2026.',
       'Net VAT payable: 11,116,200 SAR.',
       'No reconciliation gaps vs. STC general ledger.',
       'ZATCA-ready format, e-invoicing references included.'
     ],
     array[]::text[],
     'Safe to approve.',
     0.95, null,
     now() - interval '11 days' - interval '2 hours'),
    (v_tenant, v_run_id, v_step3, null, 'mock',
     'Independent review confirms VAT return is consistent with workpapers and supporting evidence.',
     array[
       'All 4 supporting workpapers tied out.',
       'Sample of 25 input VAT invoices recalculated; no exceptions.',
       'Output VAT reconciliation matches sales journal.'
     ],
     array[]::text[],
     'Recommend approve.',
     0.93, null,
     now() - interval '8 days' - interval '3 hours'),
    (v_tenant, v_run_id, v_step4, null, 'mock',
     'Final partner review summary. Engagement complies with ZATCA Phase 2 requirements.',
     array[
       'All prior approvals consistent.',
       'No unresolved review notes.',
       'Compliant with ZATCA Phase 2 e-invoicing.'
     ],
     array[]::text[],
     'Approve and file.',
     0.97, null,
     now() - interval '6 days' - interval '5 hours');

  -- Audit log entries
  insert into dms_workflow_audit_log (
    tenant_id, run_id, run_step_id, actor_kind, actor_user_id, actor_signer_id,
    action, details, ip_address, occurred_at
  ) values
    (v_tenant, v_run_id, null, 'user',
     '22222222-0000-0000-0000-000000000003', null,
     'workflow_started', '{"template":"Engagement Letter Approval"}'::jsonb,
     '10.0.0.43', now() - interval '12 days'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'step_activated', '{"order_index":1}'::jsonb,
     null, now() - interval '12 days'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'ai_analysis_generated', '{"step":"intake","confidence":0.96}'::jsonb,
     null, now() - interval '11 days' - interval '4 hours'),
    (v_tenant, v_run_id, v_step1, 'user',
     '22222222-0000-0000-0000-000000000001', null,
     'signer_approved', '{"step":"intake"}'::jsonb,
     '10.0.0.41', now() - interval '11 days'),
    (v_tenant, v_run_id, v_step2, 'system', null, v_signer2,
     'signer_invited',
     '{"email":"m.alsheikh@stc.com.sa"}'::jsonb,
     null, now() - interval '11 days'),
    (v_tenant, v_run_id, v_step2, 'system', null, v_signer2,
     'email_sent',
     '{"channel":"resend","to":"m.alsheikh@stc.com.sa"}'::jsonb,
     null, now() - interval '11 days'),
    (v_tenant, v_run_id, v_step2, 'external_signer', null, v_signer2,
     'signer_viewed', '{"view_count":1}'::jsonb,
     '85.222.10.14', now() - interval '10 days'),
    (v_tenant, v_run_id, v_step2, 'external_signer', null, v_signer2,
     'signer_approved',
     '{"step":"client_signature","reason":"Numbers reconcile."}'::jsonb,
     '85.222.10.14', now() - interval '8 days'),
    (v_tenant, v_run_id, v_step3, 'user',
     '22222222-0000-0000-0000-000000000002', null,
     'signer_approved', '{"step":"internal_review"}'::jsonb,
     '10.0.0.42', now() - interval '6 days'),
    (v_tenant, v_run_id, v_step4, 'user',
     '22222222-0000-0000-0000-000000000003', null,
     'signer_approved', '{"step":"final_approval"}'::jsonb,
     '10.0.0.43', now() - interval '5 days'),
    (v_tenant, v_run_id, null, 'system', null, null,
     'workflow_completed', '{"final_status":"completed"}'::jsonb,
     null, now() - interval '5 days');
end $$;

-- ============================================================
-- 4) RUN 3 — Rejected (Diriyah Construction working paper)
-- ============================================================
do $$
declare
  v_doc_id uuid;
  v_tenant uuid := '11111111-1111-1111-1111-111111111111';
  v_client_id uuid := 'cccccccc-0000-0000-0000-000000000004';
  v_engagement_id uuid := 'eeeeeeee-0000-0000-0000-000000000004';
  v_run_id uuid := 'aaaa3003-0000-0000-0000-000000000001';
  v_step1 uuid := 'aaaa4031-0000-0000-0000-000000000001';
  v_step2 uuid := 'aaaa4032-0000-0000-0000-000000000001';
  v_step3 uuid := 'aaaa4033-0000-0000-0000-000000000001';
  v_step4 uuid := 'aaaa4034-0000-0000-0000-000000000001';
  v_signer1 uuid := 'aaaa5031-0000-0000-0000-000000000001';
  v_signer2 uuid := 'aaaa5032-0000-0000-0000-000000000001';
  v_signer3 uuid := 'aaaa5033-0000-0000-0000-000000000001';
  v_signer4 uuid := 'aaaa5034-0000-0000-0000-000000000001';
begin
  select id into v_doc_id
  from dms_documents
  where tenant_id = v_tenant
    and folder_id = 'ddddffff-0004-0000-0000-000000000005'
    and doc_kind = 'working_paper'
  order by uploaded_at desc
  limit 1;

  if v_doc_id is null then
    select id into v_doc_id from dms_documents
    where tenant_id = v_tenant and client_id = v_client_id
    order by uploaded_at desc limit 1;
  end if;

  insert into dms_workflow_runs (
    id, tenant_id, template_id, document_id, client_id, engagement_id,
    initiated_by, status, current_step_id, started_at, completed_at, notes,
    created_at, updated_at
  ) values (
    v_run_id, v_tenant,
    'aaaa1111-0000-0000-0000-000000000001',
    v_doc_id, v_client_id, v_engagement_id,
    '22222222-0000-0000-0000-000000000002',
    'rejected',
    v_step3,
    now() - interval '7 days',
    now() - interval '3 days',
    'Diriyah ZATCA Phase 2 readiness assessment — rejected at internal review for reconciliation gap.',
    now() - interval '7 days',
    now() - interval '3 days'
  );

  insert into dms_workflow_run_steps (
    id, tenant_id, run_id, template_stage_id, order_index, kind, name,
    signer_kind, status, activated_at, completed_at, rejected_reason,
    created_at, updated_at
  ) values
    (v_step1, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000001',
     1, 'intake', 'Intake review', 'internal_user',
     'approved',
     now() - interval '7 days', now() - interval '6 days', null,
     now() - interval '7 days', now() - interval '6 days'),
    (v_step2, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000002',
     2, 'client_signature', 'Client signature', 'external',
     'approved',
     now() - interval '6 days', now() - interval '4 days', null,
     now() - interval '7 days', now() - interval '4 days'),
    (v_step3, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000003',
     3, 'internal_review', 'Internal review', 'internal_user',
     'rejected',
     now() - interval '4 days', now() - interval '3 days',
     'Numbers don''t reconcile to ledger; needs re-work.',
     now() - interval '7 days', now() - interval '3 days'),
    (v_step4, v_tenant, v_run_id,
     'aaaa2222-0000-0000-0000-000000000004',
     4, 'final_approval', 'Final approval', 'internal_user',
     'pending', null, null, null,
     now() - interval '7 days', now() - interval '7 days');

  insert into dms_workflow_signers (
    id, tenant_id, run_step_id, signer_kind, internal_user_id,
    external_name, external_email, external_role, notify_sent_at, created_at
  ) values
    (v_signer1, v_tenant, v_step1, 'internal_user',
     '22222222-0000-0000-0000-000000000002',
     null, null, 'Practice Manager',
     now() - interval '7 days',
     now() - interval '7 days'),
    (v_signer2, v_tenant, v_step2, 'external', null,
     'Saad Al-Qahtani', 's.alqahtani@diriyah-build.sa', 'Diriyah Operations Director',
     now() - interval '6 days',
     now() - interval '6 days'),
    -- Faisal Bin Hamad (Tax Manager) — internal review rejector
    (v_signer3, v_tenant, v_step3, 'internal_user',
     '22222222-0000-0000-0000-000000000002',
     null, null, 'Tax Manager (Faisal Bin Hamad)',
     now() - interval '4 days',
     now() - interval '4 days'),
    (v_signer4, v_tenant, v_step4, 'internal_user',
     '22222222-0000-0000-0000-000000000003',
     null, null, 'Managing Partner',
     null,
     now() - interval '7 days');

  insert into dms_workflow_signatures (
    tenant_id, run_step_id, signer_id, decision, reason,
    signer_ip, signer_user_agent, signed_at
  ) values
    (v_tenant, v_step1, v_signer1, 'approve',
     'Initial scope review complete.',
     '10.0.0.42', 'Mozilla/5.0 (Macintosh)',
     now() - interval '6 days'),
    (v_tenant, v_step2, v_signer2, 'approve',
     'Approved on behalf of Diriyah Construction.',
     '94.108.22.7', 'Mozilla/5.0 (Windows)',
     now() - interval '4 days'),
    (v_tenant, v_step3, v_signer3, 'reject',
     'Numbers don''t reconcile to ledger; needs re-work.',
     '10.0.0.42', 'Mozilla/5.0 (Macintosh)',
     now() - interval '3 days');

  insert into dms_workflow_ai_analyses (
    tenant_id, run_id, run_step_id, prompt, model,
    summary, key_points, risk_flags, recommendation, confidence,
    raw_output, generated_at
  ) values
    (v_tenant, v_run_id, v_step1, null, 'mock',
     'ZATCA Phase 2 readiness assessment for Diriyah Construction. Identifies gaps in e-invoicing integration.',
     array[
       'Coverage: 98% of vendor invoices in scope.',
       '6 integration gaps identified for ZATCA Phase 2.',
       'Recommended remediation timeline: 6 weeks.'
     ],
     array[]::text[],
     'Recommend approve and route to client.',
     0.89, null,
     now() - interval '7 days' + interval '2 hours'),
    (v_tenant, v_run_id, v_step2, null, 'mock',
     'Client-friendly summary of the ZATCA Phase 2 readiness work.',
     array[
       'Diriyah is 98% ready for ZATCA Phase 2 e-invoicing.',
       'Six minor gaps identified, all addressable within 6 weeks.',
       'Project plan included for remediation.'
     ],
     array[]::text[],
     'Recommend approve.',
     0.90, null,
     now() - interval '6 days' + interval '1 hour'),
    (v_tenant, v_run_id, v_step3, null, 'mock',
     'Internal review flagged a 28,400 SAR variance between WIP balance and trial balance.',
     array[
       'WIP balance per workpaper: 4,128,400 SAR.',
       'Trial balance WIP account: 4,100,000 SAR.',
       'Variance: 28,400 SAR — unreconciled.',
       'Likely cause: late vendor accruals not posted.'
     ],
     array['unreconciled_variance','requires_rework'],
     'Recommend reject and request reconciliation before approval.',
     0.91, null,
     now() - interval '4 days' + interval '30 minutes');

  insert into dms_workflow_audit_log (
    tenant_id, run_id, run_step_id, actor_kind, actor_user_id, actor_signer_id,
    action, details, ip_address, occurred_at
  ) values
    (v_tenant, v_run_id, null, 'user',
     '22222222-0000-0000-0000-000000000002', null,
     'workflow_started', '{"template":"Engagement Letter Approval"}'::jsonb,
     '10.0.0.42', now() - interval '7 days'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'step_activated', '{"order_index":1}'::jsonb,
     null, now() - interval '7 days'),
    (v_tenant, v_run_id, v_step1, 'system', null, null,
     'ai_analysis_generated', '{"step":"intake","confidence":0.89}'::jsonb,
     null, now() - interval '7 days' + interval '2 hours'),
    (v_tenant, v_run_id, v_step1, 'user',
     '22222222-0000-0000-0000-000000000002', null,
     'signer_approved', '{"step":"intake"}'::jsonb,
     '10.0.0.42', now() - interval '6 days'),
    (v_tenant, v_run_id, v_step2, 'system', null, v_signer2,
     'signer_invited',
     '{"email":"s.alqahtani@diriyah-build.sa"}'::jsonb,
     null, now() - interval '6 days'),
    (v_tenant, v_run_id, v_step2, 'system', null, v_signer2,
     'email_sent',
     '{"channel":"resend","to":"s.alqahtani@diriyah-build.sa"}'::jsonb,
     null, now() - interval '6 days'),
    (v_tenant, v_run_id, v_step2, 'external_signer', null, v_signer2,
     'signer_viewed', '{"view_count":2}'::jsonb,
     '94.108.22.7', now() - interval '5 days'),
    (v_tenant, v_run_id, v_step2, 'external_signer', null, v_signer2,
     'signer_approved', '{"step":"client_signature"}'::jsonb,
     '94.108.22.7', now() - interval '4 days'),
    (v_tenant, v_run_id, v_step3, 'system', null, null,
     'step_activated', '{"order_index":3,"name":"Internal review"}'::jsonb,
     null, now() - interval '4 days'),
    (v_tenant, v_run_id, v_step3, 'system', null, null,
     'ai_analysis_generated',
     '{"step":"internal_review","confidence":0.91,"flags":["unreconciled_variance"]}'::jsonb,
     null, now() - interval '4 days' + interval '30 minutes'),
    (v_tenant, v_run_id, v_step3, 'user',
     '22222222-0000-0000-0000-000000000002', null,
     'signer_rejected',
     '{"step":"internal_review","reason":"Numbers don''t reconcile to ledger; needs re-work."}'::jsonb,
     '10.0.0.42', now() - interval '3 days'),
    (v_tenant, v_run_id, null, 'system', null, null,
     'workflow_rejected',
     '{"final_status":"rejected","at_step":"internal_review"}'::jsonb,
     null, now() - interval '3 days');
end $$;
