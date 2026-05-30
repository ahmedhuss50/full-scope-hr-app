-- 034_dsb_checklist.sql
-- ============================================================================
-- DISBURSEMENT COMPLIANCE CHECKLIST (الصرف) — schema
-- ============================================================================
-- Adds two tables to support a 19-item Arabic-primary compliance checklist
-- attached to each disbursement case:
--
--   * dsb_checklist_items           — reusable item definitions
--                                     (tenant_id NULL = global default;
--                                      future per-tenant overrides supported)
--   * dsb_case_checklist_responses  — per-case per-item responses with
--                                     status, notes, AI suggestions
--
-- RUN ORDER: depends on 001..033.
--   - relies on `tenants`, `users`, `set_updated_at()`,
--     `auth_tenant_id()`, `dsb_cases`.
-- ============================================================================

-- Status of a checklist item response on a specific case
create type dsb_checklist_status as enum (
  'pending', 'verified', 'issue', 'not_mentioned', 'not_attached'
);

-- Checklist item definitions (tenant_id NULL = global default; future per-tenant overrides)
-- Uniqueness is enforced via partial indexes below (Postgres doesn't allow
-- function calls inside a UNIQUE table constraint).
create table dsb_checklist_items (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid references tenants(id) on delete cascade,  -- NULL = global default
  code              text not null,                          -- e.g. 'DOC_SEQUENCE'
  order_index       int not null,
  prompt_en         text not null,
  prompt_ar         text not null,
  ai_check_capable  boolean not null default true,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Partial unique indexes: (code) for global items, (tenant_id, code) for tenant-specific.
create unique index dsb_checklist_items_global_code_uq
  on dsb_checklist_items (code)
  where tenant_id is null;

create unique index dsb_checklist_items_tenant_code_uq
  on dsb_checklist_items (tenant_id, code)
  where tenant_id is not null;

create index dsb_checklist_items_order_idx on dsb_checklist_items (tenant_id, order_index);

-- Per-case per-item responses
create table dsb_case_checklist_responses (
  id                       uuid primary key default uuid_generate_v4(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  case_id                  uuid not null references dsb_cases(id) on delete cascade,
  checklist_item_id        uuid not null references dsb_checklist_items(id) on delete cascade,
  status                   dsb_checklist_status not null default 'pending',
  notes                    text,
  ai_suggested_status      dsb_checklist_status,
  ai_suggested_notes       text,
  ai_confidence            numeric(3,2),
  responded_by_user_id     uuid references users(id),
  responded_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (case_id, checklist_item_id)
);
create index dsb_case_checklist_responses_case_idx on dsb_case_checklist_responses (tenant_id, case_id);

create trigger trg_dsb_chk_resp_updated_at
  before update on dsb_case_checklist_responses
  for each row execute function set_updated_at();

alter table dsb_checklist_items            enable row level security;
alter table dsb_case_checklist_responses   enable row level security;

-- Items: tenant rows scoped, global (NULL tenant_id) visible to all
create policy dsb_chk_item_sel on dsb_checklist_items
  for select using (tenant_id is null or tenant_id = auth_tenant_id());
create policy dsb_chk_item_mod on dsb_checklist_items
  for all
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

-- Responses: tenant scoped
create policy dsb_chk_resp_sel on dsb_case_checklist_responses
  for select using (tenant_id = auth_tenant_id());
create policy dsb_chk_resp_mod on dsb_case_checklist_responses
  for all
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

-- ============================================================
-- Seed the 19 default items (tenant_id NULL = global)
-- ============================================================
insert into dsb_checklist_items (tenant_id, code, order_index, prompt_en, prompt_ar) values
  (null, 'DOC_SEQUENCE',         1,  'Verify document sequence number',                                                                  'التحقق من تسلسل الوثيقة'),
  (null, 'DOC_DATE',              2,  'Verify document date',                                                                              'التحقق من تاريخ الوثيقة'),
  (null, 'OPENING_BALANCE',       3,  'Reconcile opening balances against the previous document',                                          'مراجعة الأرصدة الافتتاحية مع الوثيقة السابقة'),
  (null, 'INVOICE_CLIENT',        4,  'Verify client name on the invoice',                                                                 'التحقق من اسم العميل في الفاتورة'),
  (null, 'INVOICE_DATE',          5,  'Verify invoice date is close to document date',                                                     'التحقق من تاريخ الفاتورة مقاربة لتاريخ الوثيقة'),
  (null, 'INVOICE_NOT_PAID',      6,  'Confirm the invoice has not been paid previously',                                                  'التأكد من عدم سداد الفاتورة مسبقاً'),
  (null, 'INVOICE_RECORDED',      7,  'Verify invoice is recorded in the vendor and journal entries',                                      'مطابقة ادخال الفاتورة في كشف الموردين والقيد'),
  (null, 'SERVICE_RECEIVED',      8,  'Confirm service / goods receipt',                                                                   'التأكد من استلام الخدمة'),
  (null, 'CONTRACT_PRICES',       9,  'Verify prices match the contract',                                                                  'التأكد من مطابقة الأسعار مع العقد'),
  (null, 'TOTAL_RECALC',         10,  'Recalculate invoice totals',                                                                        'إعادة تجميع الفاتورة'),
  (null, 'PROGRESS_PERCENT',     11,  'Verify progress percentages match the engineering estimate',                                        'مراجعة صحة نسب الإنجاز في الاحتساب مع التقدير الهندسي'),
  (null, 'ACCOUNT_SUFFICIENCY',  12,  'Verify sufficiency of construction / non-construction account',                                     'التحقق من كفاية الحساب الإنشائي / غير الإنشائي'),
  (null, 'BENEFICIARY_ACCOUNT',  13,  'Verify beneficiary account is correct',                                                             'التأكد من صحة حساب المستفيد'),
  (null, 'GUARANTEE_ACCOUNT',    14,  'Verify the guarantee account stated in the document is correct',                                    'التأكد من صحة حساب الضمان المذكور في الوثيقة'),
  (null, 'EXPENSE_NATURE',       15,  'Verify expense nature and the suitability of the source account',                                   'التحقق من طبيعة المصروف ومناسبة الحساب المصروف منه (إنشائي / غير إنشائي)'),
  (null, 'TOTAL_VS_INVOICES',    16,  'Verify the total in the disbursement document matches invoices',                                    'التأكد من المجموع في وثيقة الصرف مع الفواتير'),
  (null, 'DEVELOPER_REVIEW',     17,  'Verify developer review and approval signature matches',                                            'التأكد من المراجعة والاعتماد من المطورين بمطابقة التوقيع'),
  (null, 'ENGINEER_APPROVAL',    18,  'Verify engineering supervisor approval signature matches',                                          'التحقق من اعتماد المشرف الهندسي بمطابقة التوقيع'),
  (null, 'AUTHORIZED_PAYMENT',   19,  'Verify authorized signatories from the developer have approved payment',                            'التأكد من اعتماد المفوضين من المطور باعتماد السداد')
on conflict do nothing;
