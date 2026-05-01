-- 011_indexes.sql
-- Indexes for tenant-filtered reads, foreign-key joins, and common dashboard queries.

-- Core
create index idx_users_tenant                  on users(tenant_id);
create index idx_users_tenant_email            on users(tenant_id, email);
create index idx_user_roles_user               on user_roles(user_id);

-- Reference
create index idx_departments_tenant            on departments(tenant_id);
create index idx_work_locations_tenant         on work_locations(tenant_id);
create index idx_practice_areas_tenant         on practice_areas(tenant_id);
create index idx_job_requisitions_tenant       on job_requisitions(tenant_id);
create index idx_job_requisitions_status       on job_requisitions(tenant_id, status);
create index idx_job_requisitions_practice     on job_requisitions(practice_area_id);

-- Candidates
create index idx_candidates_tenant             on candidates(tenant_id);
create index idx_candidates_tenant_created     on candidates(tenant_id, created_at desc);
create index idx_candidates_email              on candidates(tenant_id, lower(primary_email));
create index idx_candidates_phone              on candidates(tenant_id, mobile_phone);
create index idx_candidates_cpa_track          on candidates(tenant_id, cpa_track);
create index idx_candidates_practice_area      on candidates(tenant_id, primary_practice_area);

-- Applications
create index idx_applications_tenant           on applications(tenant_id);
create index idx_applications_candidate        on applications(candidate_id);
create index idx_applications_status           on applications(tenant_id, status);
create index idx_applications_req              on applications(job_requisition_id);
create index idx_applications_applied_at       on applications(tenant_id, applied_at desc);
create index idx_app_status_history_app        on application_status_history(application_id);
create index idx_app_status_history_tenant     on application_status_history(tenant_id);

-- Interviews
create index idx_interviews_tenant             on interviews(tenant_id);
create index idx_interviews_application        on interviews(application_id);
create index idx_interviews_interviewer        on interviews(interviewer_user_id);
create index idx_interviews_status             on interviews(tenant_id, status);
create index idx_interviews_scheduled_start    on interviews(tenant_id, scheduled_start);
create index idx_interview_slots_interview     on interview_slots(interview_id);
create index idx_interview_slots_tenant        on interview_slots(tenant_id);
create index idx_interview_recordings_tenant   on interview_recordings(tenant_id);
create index idx_interview_recordings_intv     on interview_recordings(interview_id);
create index idx_interview_transcripts_tenant  on interview_transcripts(tenant_id);
create index idx_interview_transcripts_rec     on interview_transcripts(interview_recording_id);
create index idx_interview_scorecards_tenant   on interview_scorecards(tenant_id);
create index idx_interview_scorecards_intv     on interview_scorecards(interview_id);
create index idx_interview_decisions_tenant    on interview_decisions(tenant_id);
create index idx_interview_decisions_intv      on interview_decisions(interview_id);

-- Employees / Vendors
create index idx_employees_tenant              on employees(tenant_id);
create index idx_employees_tenant_active       on employees(tenant_id, active);
create index idx_employees_hire_date           on employees(tenant_id, hire_date);
create index idx_employees_department          on employees(department_id);
create index idx_employees_practice_area       on employees(practice_area_id);
create index idx_employees_supervisor          on employees(direct_supervisor_id);
create index idx_employees_location            on employees(work_location_id);
create index idx_employees_origin              on employees(origin_candidate_id);
create index idx_employees_cert_status         on employees(tenant_id, cert_status);
create index idx_employees_license_expires     on employees(tenant_id, primary_license_expires_on);

create index idx_vendors_tenant                on vendors(tenant_id);
create index idx_vendors_tenant_active         on vendors(tenant_id, active);
create index idx_vendors_origin                on vendors(origin_candidate_id);

create index idx_hire_events_tenant            on hire_events(tenant_id);
create index idx_hire_events_candidate         on hire_events(candidate_id);
create index idx_emp_pay_history_tenant        on employee_pay_rate_history(tenant_id);
create index idx_emp_pay_history_emp           on employee_pay_rate_history(employee_id);
create index idx_classification_changes_tenant on classification_changes(tenant_id);
create index idx_emergency_contacts_tenant     on emergency_contacts(tenant_id);
create index idx_emergency_contacts_owner      on emergency_contacts(employee_id, vendor_id);

-- Compliance / Docs
create index idx_documents_tenant              on documents(tenant_id);
create index idx_documents_employee            on documents(employee_id);
create index idx_documents_vendor              on documents(vendor_id);
create index idx_documents_status              on documents(tenant_id, status);
create index idx_doc_templates_tenant          on document_templates(tenant_id);
create index idx_doc_signatures_tenant         on document_signatures(tenant_id);
create index idx_doc_signatures_doc            on document_signatures(document_id);
create index idx_gcc_compliance_tenant         on gcc_compliance_records(tenant_id);
create index idx_gcc_compliance_employee       on gcc_compliance_records(employee_id);
create index idx_gcc_compliance_vendor         on gcc_compliance_records(vendor_id);
create index idx_gcc_compliance_expires        on gcc_compliance_records(tenant_id, expires_on);
create index idx_background_checks_employee    on background_checks(employee_id);
create index idx_background_checks_tenant      on background_checks(tenant_id);
create index idx_drug_tests_employee           on drug_tests(employee_id);
create index idx_drug_tests_tenant             on drug_tests(tenant_id);
create index idx_direct_deposit_employee       on direct_deposit_accounts(employee_id);
create index idx_direct_deposit_vendor         on direct_deposit_accounts(vendor_id);
create index idx_direct_deposit_tenant         on direct_deposit_accounts(tenant_id);

-- Benefits / PTO / Onboarding
create index idx_benefits_classes_tenant       on benefits_classes(tenant_id);
create index idx_benefit_plans_tenant          on benefit_plans(tenant_id);
create index idx_benefit_enrollments_tenant    on benefit_enrollments(tenant_id);
create index idx_benefit_enrollments_employee  on benefit_enrollments(employee_id);
create index idx_pto_policies_tenant           on pto_policies(tenant_id);
create index idx_pto_balances_tenant           on pto_balances(tenant_id);
create index idx_pto_balances_employee         on pto_balances(employee_id);
create index idx_pto_transactions_tenant       on pto_transactions(tenant_id);
create index idx_pto_transactions_balance      on pto_transactions(pto_balance_id);
create index idx_onboarding_roles_tenant       on onboarding_roles(tenant_id);
create index idx_onboarding_tracks_tenant      on onboarding_tracks(tenant_id);
create index idx_onboarding_tracks_role        on onboarding_tracks(onboarding_role_id);
create index idx_onboarding_modules_tenant     on onboarding_modules(tenant_id);
create index idx_onboarding_modules_track      on onboarding_modules(onboarding_track_id);
create index idx_onboarding_completions_tenant on onboarding_completions(tenant_id);
create index idx_onboarding_completions_emp    on onboarding_completions(employee_id);

-- Payroll Sync
create index idx_qbo_connections_tenant        on qbo_connections(tenant_id);
create index idx_xero_connections_tenant       on xero_connections(tenant_id);
create index idx_sage_connections_tenant       on sage_connections(tenant_id);
create index idx_sync_queue_tenant_status      on sync_queue(tenant_id, status, queued_at);
create index idx_sync_events_tenant            on sync_events(tenant_id);
create index idx_sync_events_queue             on sync_events(sync_queue_id);

-- System logs (time-series heavy; partition in future migration if needed)
create index idx_audit_log_tenant_at           on audit_log(tenant_id, at desc);
create index idx_audit_log_entity              on audit_log(entity_kind, entity_id);
create index idx_pii_access_log_tenant_at      on pii_access_log(tenant_id, at desc);
create index idx_pii_access_log_entity         on pii_access_log(entity_kind, entity_id);
create index idx_notification_templates_tenant on notification_templates(tenant_id);
create index idx_notification_log_tenant_sent  on notification_log(tenant_id, sent_at desc);
create index idx_translations_tenant_key       on translations(tenant_id, key);

-- Phase 2 / 3 stubs
create index idx_clients_tenant                on clients(tenant_id);
create index idx_engagements_tenant            on engagements(tenant_id);
create index idx_engagements_client            on engagements(client_id);
create index idx_employee_credentials_tenant   on employee_credentials(tenant_id);
create index idx_employee_credentials_employee on employee_credentials(employee_id);
create index idx_firm_credentials_tenant       on firm_credentials(tenant_id);
