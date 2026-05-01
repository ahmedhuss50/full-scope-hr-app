/**
 * Source-of-truth translation dictionary. Every user-facing string passes
 * through this. Keep keys stable — they are the join across UI, SMS
 * templates, and server-logged notifications.
 *
 * Future: load per-tenant overrides from the `translations` table in Supabase.
 *
 * Full Scope HR translates EN ↔ AR (Modern Standard Arabic, professional accounting register).
 */
export type Locale = 'en' | 'ar'

export const strings = {
  'app.name':    { en: 'Full Scope HR',                      ar: 'Full Scope HR' },
  'app.tagline': { en: 'Professional services HR, automated.', ar: 'إدارة الموارد البشرية للخدمات المهنية، آليًا.' },

  'nav.dashboard':    { en: 'Dashboard',    ar: 'لوحة التحكم' },
  'nav.applications': { en: 'Applications', ar: 'طلبات التوظيف' },
  'nav.onboarding':   { en: 'Onboarding',   ar: 'تأهيل الموظفين' },
  'nav.employees':    { en: 'Employees',    ar: 'الموظفون' },
  'nav.jobs':         { en: 'Jobs',         ar: 'الوظائف' },
  'nav.signout':      { en: 'Sign out',     ar: 'تسجيل الخروج' },
  'nav.sign_out':     { en: 'Sign out',     ar: 'تسجيل الخروج' },

  'dashboard.applications_this_month': { en: 'Applications (this month)', ar: 'الطلبات (هذا الشهر)' },
  'dashboard.open_jobs':               { en: 'Open Jobs',                 ar: 'الوظائف المفتوحة' },
  'dashboard.active_employees':        { en: 'Active Employees',          ar: 'الموظفون النشطون' },
  'dashboard.pending_interviews':      { en: 'Pending Interviews',        ar: 'مقابلات معلّقة' },
  'dashboard.recent_applications':     { en: 'Recent applications',       ar: 'أحدث الطلبات' },

  'onboarding.title': { en: 'Onboarding',                                       ar: 'تأهيل الموظفين' },
  'onboarding.empty': { en: 'No employees in onboarding right now.',            ar: 'لا يوجد موظفون قيد التأهيل حاليًا.' },

  'employees.title':           { en: 'Employees',         ar: 'الموظفون' },
  'employees.empty':           { en: 'No active employees yet.', ar: 'لا يوجد موظفون نشطون حتى الآن.' },
  'employees.col.name':        { en: 'Name',              ar: 'الاسم' },
  'employees.col.email':       { en: 'Email',             ar: 'البريد الإلكتروني' },
  'employees.col.department':  { en: 'Department',        ar: 'القسم' },
  'employees.col.role':        { en: 'Role',              ar: 'المسمّى الوظيفي' },

  'jobs.title':               { en: 'Jobs',                ar: 'الوظائف' },
  'jobs.empty':               { en: 'No open job requisitions.', ar: 'لا توجد طلبات توظيف مفتوحة.' },
  'jobs.applications_count':  { en: 'Applications',         ar: 'عدد الطلبات' },
  'jobs.col.title':           { en: 'Title',                ar: 'المسمّى الوظيفي' },
  'jobs.col.department':      { en: 'Department',           ar: 'القسم' },
  'jobs.col.status':          { en: 'Status',               ar: 'الحالة' },
  'jobs.col.opened_at':       { en: 'Opened',               ar: 'تاريخ الفتح' },

  // Create-job form
  'jobs.create_button':            { en: 'Create job',           ar: 'إنشاء وظيفة' },
  'jobs.new.title':                { en: 'Create job posting',   ar: 'إنشاء إعلان وظيفي' },
  'jobs.new.field.title':          { en: 'Title',                ar: 'المسمّى الوظيفي' },
  'jobs.new.field.description':    { en: 'Description',          ar: 'الوصف' },
  'jobs.new.field.department':     { en: 'Department',           ar: 'القسم' },
  'jobs.new.field.practice_area':  { en: 'Practice area',        ar: 'مجال الممارسة' },
  'jobs.new.field.work_location':  { en: 'Work location',        ar: 'موقع العمل' },
  'jobs.new.field.classification': { en: 'Classification',       ar: 'نوع التعاقد' },
  'jobs.new.field.pay_type':       { en: 'Pay type',             ar: 'نوع الأجر' },
  'jobs.new.field.pay_min':        { en: 'Pay min',              ar: 'الحد الأدنى للأجر' },
  'jobs.new.field.pay_max':        { en: 'Pay max',              ar: 'الحد الأعلى للأجر' },
  'jobs.new.field.pay_currency':   { en: 'Currency',             ar: 'العملة' },
  'jobs.new.field.openings':       { en: 'Openings',             ar: 'عدد الشواغر' },
  'jobs.new.field.status':         { en: 'Status',               ar: 'الحالة' },
  'jobs.new.submit':               { en: 'Create job',           ar: 'إنشاء الوظيفة' },
  'jobs.new.submitting':           { en: 'Creating…',            ar: 'جارٍ الإنشاء…' },
  'jobs.new.cancel':               { en: 'Cancel',               ar: 'إلغاء' },

  'applications.title': { en: 'Applications', ar: 'طلبات التوظيف' },

  'login.title':       { en: 'Sign in', ar: 'تسجيل الدخول' },
  'login.subtitle':    { en: 'Enter your work email. We\u2019ll send you a magic link.', ar: 'أدخل بريدك الإلكتروني المهني. سنرسل لك رابط الدخول الفوري.' },
  'login.email':       { en: 'Email', ar: 'البريد الإلكتروني' },
  'login.send':        { en: 'Send link', ar: 'إرسال الرابط' },
  'login.sent_title':  { en: 'Check your email', ar: 'تحقق من بريدك الإلكتروني' },
  'login.sent_body':   { en: 'We sent a link to {email}. It expires in 15 minutes.', ar: 'أرسلنا رابطًا إلى {email}. ينتهي خلال 15 دقيقة.' },
  'login.error':       { en: 'Could not send link. Please try again.', ar: 'تعذّر إرسال الرابط. يرجى المحاولة مرة أخرى.' },

  'apply.welcome':   { en: 'Apply to {company}', ar: 'قدّم طلبك إلى {company}' },
  'apply.intro':     { en: 'This takes about 4 minutes. Your information is private and stored securely.', ar: 'يستغرق هذا حوالي 4 دقائق. بياناتك سرية ومحفوظة بأمان.' },
  'apply.lang_note': { en: 'You can switch languages anytime.', ar: 'يمكنك تغيير اللغة في أي وقت.' },
  'apply.step':      { en: 'Step {n} of {total}', ar: 'الخطوة {n} من {total}' },

  'form.legal_first_name': { en: 'Legal first name', ar: 'الاسم القانوني الأول' },
  'form.legal_last_name':  { en: 'Legal last name',  ar: 'اللقب (اسم العائلة)' },
  'form.preferred_name':   { en: 'Preferred name (optional)', ar: 'الاسم المُفضّل (اختياري)' },
  'form.mobile_phone':     { en: 'Mobile phone', ar: 'رقم الجوّال' },
  'form.primary_email':    { en: 'Email', ar: 'البريد الإلكتروني' },
  'form.home_country':     { en: 'Country of residence', ar: 'بلد الإقامة' },
  'form.home_city':        { en: 'City', ar: 'المدينة' },
  'form.home_postal':      { en: 'Postal code', ar: 'الرمز البريدي' },

  'form.role':         { en: 'Role you\u2019re applying for', ar: 'الوظيفة المتقدّم لها' },
  'form.select_role':  { en: 'Select a role', ar: 'اختر وظيفة' },

  'form.work_auth.label':                       { en: 'Work authorization', ar: 'تصريح العمل' },
  'form.work_auth.GCC National':                { en: 'GCC National', ar: 'مواطن خليجي' },
  'form.work_auth.GCC Resident':                { en: 'GCC Resident', ar: 'مقيم في دول الخليج' },
  'form.work_auth.Permanent Resident':          { en: 'Permanent Resident', ar: 'مقيم دائم' },
  'form.work_auth.Work Visa Sponsored':         { en: 'Work Visa Sponsored', ar: 'تأشيرة عمل برعاية' },
  'form.work_auth.Citizen of Hiring Country':   { en: 'Citizen of hiring country', ar: 'مواطن في بلد التوظيف' },
  'form.work_auth.Requires Sponsorship':        { en: 'Requires sponsorship', ar: 'يحتاج إلى كفالة' },

  'form.classification.label': { en: 'How would you like to engage?', ar: 'كيف تُفضّل الانضمام؟' },
  'form.classification.W-2':   { en: 'Full employee', ar: 'موظف بدوام كامل' },
  'form.classification.1099':  { en: 'Independent contractor', ar: 'متعاقد مستقل' },

  // Full Scope HR-specific qualification fields
  'form.cpa_track.label':   { en: 'Are you on a CPA / professional certification track?', ar: 'هل أنت على مسار شهادة محاسبية مهنية (CPA / SOCPA)؟' },
  'form.cpa_track.yes':     { en: 'Yes', ar: 'نعم' },
  'form.cpa_track.no':      { en: 'No',  ar: 'لا' },

  'form.licenses_held.label':  { en: 'Licenses & certifications held', ar: 'الشهادات والتراخيص المهنية الحاصل عليها' },
  'form.licenses_held.help':   { en: 'Select all that apply', ar: 'اختر كل ما ينطبق' },
  'form.license.CPA':          { en: 'CPA',   ar: 'محاسب قانوني معتمد (CPA)' },
  'form.license.CFA':          { en: 'CFA',   ar: 'محلل مالي معتمد (CFA)' },
  'form.license.EA':           { en: 'EA',    ar: 'وكيل ضريبي معتمد (EA)' },
  'form.license.SOCPA':        { en: 'SOCPA', ar: 'الهيئة السعودية للمحاسبين (SOCPA)' },
  'form.license.ZATCA':        { en: 'ZATCA certified', ar: 'شهادة هيئة الزكاة والضريبة (ZATCA)' },
  'form.license.IFRS':         { en: 'IFRS Diploma', ar: 'دبلوم المعايير الدولية (IFRS)' },
  'form.license.ACCA':         { en: 'ACCA',  ar: 'الجمعية البريطانية للمحاسبين (ACCA)' },
  'form.license.CIA':          { en: 'CIA',   ar: 'مدقق داخلي معتمد (CIA)' },
  'form.license.CMA':          { en: 'CMA',   ar: 'محاسب إداري معتمد (CMA)' },

  'form.jurisdictions.label':  { en: 'Jurisdictions you have worked in', ar: 'الدول والأسواق التي عملت فيها' },
  'form.jurisdictions.help':   { en: 'Select all that apply', ar: 'اختر كل ما ينطبق' },
  'form.jurisdiction.KSA':     { en: 'Saudi Arabia (KSA)', ar: 'المملكة العربية السعودية' },
  'form.jurisdiction.UAE':     { en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة' },
  'form.jurisdiction.GCC':     { en: 'Other GCC', ar: 'دول خليجية أخرى' },
  'form.jurisdiction.US':      { en: 'United States', ar: 'الولايات المتحدة' },
  'form.jurisdiction.EU':      { en: 'European Union', ar: 'الاتحاد الأوروبي' },
  'form.jurisdiction.UK':      { en: 'United Kingdom', ar: 'المملكة المتحدة' },
  'form.jurisdiction.Other':   { en: 'Other', ar: 'أخرى' },

  'form.years_audit_experience.label': { en: 'Years of audit experience', ar: 'سنوات الخبرة في التدقيق' },
  'form.years_experience.label':       { en: 'Total years of experience', ar: 'إجمالي سنوات الخبرة' },

  'form.arabic_fluency.label':  { en: 'Arabic fluency',  ar: 'إجادة اللغة العربية' },
  'form.english_fluency.label': { en: 'English fluency', ar: 'إجادة اللغة الإنجليزية' },
  'form.fluency.native':        { en: 'Native',         ar: 'لغة أم' },
  'form.fluency.fluent':        { en: 'Fluent',         ar: 'إجادة تامة' },
  'form.fluency.conversational':{ en: 'Conversational', ar: 'مستوى المحادثة' },
  'form.fluency.basic':         { en: 'Basic',          ar: 'مستوى أساسي' },
  'form.fluency.none':          { en: 'None',           ar: 'لا يوجد' },

  'form.primary_practice_area.label': { en: 'Primary practice area', ar: 'مجال التخصص الأساسي' },
  'form.practice.audit':              { en: 'Audit & Assurance', ar: 'التدقيق والتأمين' },
  'form.practice.tax':                { en: 'Tax Services',      ar: 'الخدمات الضريبية' },
  'form.practice.advisory':           { en: 'Advisory',          ar: 'الاستشارات' },
  'form.practice.bd':                 { en: 'Business Development', ar: 'تطوير الأعمال' },
  'form.practice.admin':              { en: 'Administration',    ar: 'الإدارة' },

  'form.source.label':       { en: 'How did you hear about us?', ar: 'كيف وصلت إلينا؟' },
  'form.source.walk_in':     { en: 'Walk-in',                    ar: 'زيارة مباشرة للمكتب' },
  'form.source.referral':    { en: 'Referred by someone',        ar: 'توصية من شخص' },
  'form.source.linkedin':    { en: 'LinkedIn',                   ar: 'لينكدإن' },
  'form.source.indeed':      { en: 'Indeed',                     ar: 'إنديد' },
  'form.source.bayt':        { en: 'Bayt.com',                   ar: 'بيت دوت كوم' },
  'form.source.naukrigulf':  { en: 'Naukrigulf',                 ar: 'نوكري جلف' },
  'form.source.website':     { en: 'Company website',            ar: 'الموقع الإلكتروني للشركة' },
  'form.source.whatsapp':    { en: 'WhatsApp',                   ar: 'واتساب' },
  'form.source.other':       { en: 'Other',                      ar: 'أخرى' },

  'form.resume.label':        { en: 'CV / Resume (optional)', ar: 'السيرة الذاتية (اختياري)' },
  'form.resume.help':         { en: 'PDF, DOC, or DOCX · Max 10MB', ar: 'PDF أو DOC أو DOCX · الحد الأقصى 10 ميجابايت' },
  'form.resume.choose':       { en: 'Choose file', ar: 'اختيار ملف' },
  'form.resume.remove':       { en: 'Remove', ar: 'إزالة' },
  'form.resume.too_large':    { en: 'File too large (max 10MB)', ar: 'حجم الملف كبير جدًا (الحد الأقصى 10 ميجابايت)' },
  'form.resume.invalid_type': { en: 'Only PDF, DOC, or DOCX files are supported', ar: 'يُقبل فقط ملفات PDF أو DOC أو DOCX' },
  'form.resume.uploading':    { en: 'Uploading CV…', ar: 'جارٍ تحميل السيرة الذاتية…' },

  'form.submit':     { en: 'Submit application', ar: 'إرسال الطلب' },
  'form.submitting': { en: 'Submitting…',         ar: 'جارٍ الإرسال…' },
  'form.continue':   { en: 'Continue',           ar: 'متابعة' },
  'form.back':       { en: 'Back',               ar: 'رجوع' },

  'apply.submitted.title': { en: 'Application received', ar: 'تم استلام طلبك' },
  'apply.submitted.body':  { en: 'Thank you, {name}. We review applications the same day. You will receive an email if we would like to talk further.', ar: 'شكرًا لك يا {name}. نراجع الطلبات في نفس اليوم. سنتواصل معك عبر البريد الإلكتروني إذا رغبنا في إجراء مقابلة.' },

  'dashboard.title':            { en: 'Candidate queue', ar: 'قائمة المرشّحين' },
  'dashboard.new_today':        { en: '{n} new today',   ar: '{n} مرشّح جديد اليوم' },
  'dashboard.empty':            { en: 'No candidates yet. Share your application link to get started.', ar: 'لا يوجد مرشّحون حتى الآن. شارك رابط التقديم للبدء.' },
  'dashboard.apply_link':       { en: 'Public application link', ar: 'رابط التقديم العام' },
  'dashboard.filter_all':       { en: 'All',         ar: 'الكل' },
  'dashboard.filter_new':       { en: 'New',         ar: 'جديد' },
  'dashboard.filter_review':    { en: 'In review',   ar: 'قيد المراجعة' },
  'dashboard.filter_interview': { en: 'Interview',   ar: 'مقابلة' },
  'dashboard.filter_hired':     { en: 'Hired',       ar: 'تم التوظيف' },

  'candidate.will_interview': { en: 'Will interview', ar: 'إجراء مقابلة' },
  'candidate.reject':         { en: 'Not a fit',     ar: 'غير مناسب' },
  'candidate.view':           { en: 'View',          ar: 'عرض' },

  'status.applied':              { en: 'Applied',              ar: 'تم التقديم' },
  'status.in_review':            { en: 'In review',            ar: 'قيد المراجعة' },
  'status.interview_pending':    { en: 'Interview pending',    ar: 'بانتظار جدولة المقابلة' },
  'status.interview_scheduled':  { en: 'Interview scheduled',  ar: 'تم تحديد موعد المقابلة' },
  'status.interview_completed':  { en: 'Interview completed',  ar: 'تمت المقابلة' },
  'status.decision_pending':     { en: 'Decision pending',     ar: 'بانتظار القرار' },
  'status.offer_extended':       { en: 'Offer extended',       ar: 'تم إرسال العرض' },
  'status.offer_accepted':       { en: 'Offer accepted',       ar: 'تم قبول العرض' },
  'status.hired':                { en: 'Hired',                ar: 'تم التوظيف' },
  'status.rejected':             { en: 'Not selected',         ar: 'لم يتم الاختيار' },
  'status.withdrawn':            { en: 'Withdrawn',            ar: 'تم السحب' },

  'schedule.title':           { en: 'Pick an interview time', ar: 'اختر موعد المقابلة' },
  'schedule.subtitle':        { en: 'Pick the slot that works best. You can reply with questions anytime.', ar: 'اختر الموعد الأنسب لك. يمكنك الرد بأي استفسار في أي وقت.' },
  'schedule.confirm':         { en: 'Confirm this time',     ar: 'تأكيد هذا الموعد' },
  'schedule.confirmed.title': { en: 'You\u2019re booked',     ar: 'تم تأكيد موعدك' },
  'schedule.confirmed.body':  { en: 'See you {when}. We will send a reminder the day before.', ar: 'نراك في {when}. سنرسل لك تذكيرًا قبل يوم من الموعد.' },

  'error.generic':      { en: 'Something went wrong. Please try again.', ar: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.' },
  'error.not_found':    { en: 'Not found.', ar: 'غير موجود.' },
  'error.unauthorized': { en: 'You need to sign in.', ar: 'يجب تسجيل الدخول.' },
} as const

export type StringKey = keyof typeof strings

export function t(key: StringKey, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = strings[key]
  if (!entry) return key
  let out: string = entry[locale] ?? entry.en
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(`{${k}}`, String(v))
    }
  }
  return out
}
