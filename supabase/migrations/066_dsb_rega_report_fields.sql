-- 066_dsb_rega_report_fields.sql
-- ----------------------------------------------------------------------------
-- REGA (الهيئة العامة للعقار) quarterly-report foundation.
--
-- Adds the two small groups of fields required to auto-generate the
-- «اشعار تسليم تقرير» delivery notice for every project:
--
--   1. TENANT: the accounting-office identity that signs every REGA
--      submission. Currently only the office display name lives on
--      `tenants.name`; the notice also needs the office's legal name,
--      authorized signer, signer title, contact email, and REGA-registered
--      license number.
--
--   2. PROJECT: the REGA license number of the project itself (distinct
--      from our internal `code`) plus the agreement dates (Hijri stored
--      as text since Postgres has no Hijri type, Gregorian as a real date).
--
-- All fields are nullable so existing rows aren't broken. The generator
-- surfaces a friendly "لم يُعبَّأ" if any required substitution is missing
-- rather than failing hard.
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) tenants — accounting-office identity for the REGA delivery notice
-- ---------------------------------------------------------------------------
alter table tenants
  add column if not exists accountant_office_name          text,     -- e.g. "شركة إتقان للاستشارات المهنية"
  add column if not exists accountant_office_license       text,     -- REGA-registered accountant office license
  add column if not exists accountant_signer_name          text,     -- e.g. "مهدي بوخمسين"
  add column if not exists accountant_signer_title         text,     -- e.g. "المدير التنفيذي"
  add column if not exists accountant_signer_email         text,     -- e.g. "mahdi@etqan-cpa.sa"
  add column if not exists rega_default_recipient_emails   text[];   -- e.g. ['h.albaqshi@fullscope.sa']

comment on column tenants.accountant_office_name is
  'Legal name of the accounting office as it appears on the REGA delivery notice header.';
comment on column tenants.accountant_office_license is
  'REGA-registered license number of the accounting office (chartered accountant registration).';
comment on column tenants.accountant_signer_name is
  'Full name of the authorized signer (typically the executive director) whose signature appears at the bottom of the delivery notice.';
comment on column tenants.accountant_signer_title is
  'Job title of the authorized signer as printed under the signature line.';
comment on column tenants.accountant_signer_email is
  'Contact email printed on the delivery notice and used as the default From address.';
comment on column tenants.rega_default_recipient_emails is
  'Default To addresses for the REGA delivery notice; the generator falls back to this list when the user doesn''t override at submission time.';

-- ---------------------------------------------------------------------------
-- 2) dsb_projects — REGA license + agreement dates
-- ---------------------------------------------------------------------------
alter table dsb_projects
  add column if not exists rega_license_no                text,   -- e.g. "أ/208"  (distinct from dsb_projects.code)
  add column if not exists rega_agreement_date_hijri     text,   -- e.g. "02 /07/1445هـ"
  add column if not exists rega_agreement_date_gregorian date;   -- e.g. 2024-01-14

comment on column dsb_projects.rega_license_no is
  'REGA (الهيئة العامة للعقار) project license number, e.g. "أ/208". Distinct from dsb_projects.code (which is our internal identifier). Used verbatim on the REGA delivery notice and every generated report page.';
comment on column dsb_projects.rega_agreement_date_hijri is
  'Hijri calendar date the tenant''s supervision agreement was signed with the developer, stored as text because Postgres has no Hijri date type. Formatted for direct rendering into the delivery notice (e.g. "02 /07/1445هـ").';
comment on column dsb_projects.rega_agreement_date_gregorian is
  'Gregorian equivalent of rega_agreement_date_hijri. Used for date arithmetic (contract age) and rendered next to the Hijri date on the delivery notice.';

-- Index so we can quickly look up a project by REGA license in future
-- integrations (e.g. searching by "أ/208").
create index if not exists dsb_projects_rega_license_idx
  on dsb_projects (tenant_id, rega_license_no)
  where rega_license_no is not null;
