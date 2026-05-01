'use client'
import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/LocaleContext'
import type {
  Classification, WorkAuth, ApplicationSource, JobRequisition,
  LicenseCode, JurisdictionCode, FluencyLevel, PracticeAreaCode,
} from '@/lib/types'
import { submitApplication } from '@/app/apply/[tenant]/actions'

// GCC + key origin countries (drop-down on the address step).
const COUNTRY_CODES = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'EG', 'JO', 'IN', 'PK', 'GB', 'US', 'Other']

const LICENSE_OPTIONS: LicenseCode[] = ['CPA', 'SOCPA', 'EA', 'CFA', 'ACCA', 'CIA', 'CMA', 'IFRS', 'ZATCA']
const JURISDICTION_OPTIONS: JurisdictionCode[] = ['KSA', 'UAE', 'GCC', 'US', 'EU', 'UK', 'Other']
const FLUENCY_OPTIONS: FluencyLevel[] = ['native', 'fluent', 'conversational', 'basic', 'none']
const PRACTICE_AREAS: PracticeAreaCode[] = ['audit', 'tax', 'advisory', 'bd', 'admin']

const MAX_RESUME_BYTES = 10 * 1024 * 1024
const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export function ApplicationForm({
  tenantSlug,
  tenantName,
  requisitions,
  preselectedJobId,
}: {
  tenantSlug: string
  tenantName: string
  requisitions: JobRequisition[]
  preselectedJobId?: string | null
}) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(1)
  const totalSteps = 3
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isLockedToJob = !!preselectedJobId && requisitions.some(r => r.id === preselectedJobId)

  const [form, setForm] = useState({
    legal_first_name: '',
    legal_last_name: '',
    preferred_name: '',
    primary_email: '',
    mobile_phone: '',
    home_country_code: 'SA',
    home_city: 'Dammam',
    home_postal_code: '',
    work_auth_status: 'GCC Resident' as WorkAuth,
    classification_preference: 'W-2' as Classification,
    source: 'website' as ApplicationSource,
    job_requisition_id: (isLockedToJob ? preselectedJobId : requisitions[0]?.id) ?? '',

    // Full Scope HR accounting-firm fields
    cpa_track: false,
    licenses_held: [] as LicenseCode[],
    jurisdictions_worked: [] as JurisdictionCode[],
    years_experience: '',
    years_audit_experience: '',
    arabic_fluency: 'fluent' as FluencyLevel,
    english_fluency: 'fluent' as FluencyLevel,
    primary_practice_area: 'audit' as PracticeAreaCode,
  })

  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [resumeError, setResumeError] = useState<string | null>(null)

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const toggleLicense = (lic: LicenseCode) =>
    setForm(f => ({
      ...f,
      licenses_held: f.licenses_held.includes(lic)
        ? f.licenses_held.filter(x => x !== lic)
        : [...f.licenses_held, lic],
    }))

  const toggleJurisdiction = (jur: JurisdictionCode) =>
    setForm(f => ({
      ...f,
      jurisdictions_worked: f.jurisdictions_worked.includes(jur)
        ? f.jurisdictions_worked.filter(x => x !== jur)
        : [...f.jurisdictions_worked, jur],
    }))

  const handleResumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setResumeError(null)
    const file = e.target.files?.[0] ?? null
    if (!file) { setResumeFile(null); return }
    if (file.size > MAX_RESUME_BYTES) {
      setResumeError(t('form.resume.too_large'))
      setResumeFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (!ALLOWED_RESUME_TYPES.has(file.type)) {
      setResumeError(t('form.resume.invalid_type'))
      setResumeFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setResumeFile(file)
  }

  const removeResume = () => {
    setResumeFile(null)
    setResumeError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canAdvance = (() => {
    if (step === 1) return !!form.legal_first_name && !!form.legal_last_name && !!form.mobile_phone
    if (step === 2) return !!form.job_requisition_id && !!form.home_country_code
    return true
  })()

  const onSubmit = () => {
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      // Scalar fields
      const scalarKeys: (keyof typeof form)[] = [
        'legal_first_name', 'legal_last_name', 'preferred_name', 'primary_email',
        'mobile_phone', 'home_country_code', 'home_city', 'home_postal_code',
        'work_auth_status', 'classification_preference', 'source',
        'job_requisition_id', 'cpa_track', 'years_experience', 'years_audit_experience',
        'arabic_fluency', 'english_fluency', 'primary_practice_area',
      ]
      for (const k of scalarKeys) fd.append(k, String(form[k]))
      // Array fields — JSON-encoded so the server action can parse them
      fd.append('licenses_held', JSON.stringify(form.licenses_held))
      fd.append('jurisdictions_worked', JSON.stringify(form.jurisdictions_worked))
      fd.append('tenant_slug', tenantSlug)
      fd.append('locale', locale)
      if (resumeFile) fd.append('resume', resumeFile)

      const res = await submitApplication(fd)
      if (!res.ok) { setError(res.error ?? t('error.generic')); return }
      router.push(`/apply/${tenantSlug}/submitted?name=${encodeURIComponent(form.legal_first_name)}`)
    })
  }

  return (
    <div className="card p-6 md:p-8">
      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-ink/50 mb-4">
        <span>{t('apply.step', { n: step, total: totalSteps })}</span>
        <span>{tenantName}</span>
      </div>

      <div className="h-1 rounded-full bg-ink/10 mb-6">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(step/totalSteps)*100}%` }} />
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <h2 className="serif font-bold text-2xl">{t('apply.welcome', { company: tenantName })}</h2>
          <p className="text-sm text-ink/70">{t('apply.intro')}</p>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('form.legal_first_name')}</label>
              <input className="input" value={form.legal_first_name} onChange={(e) => update('legal_first_name', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('form.legal_last_name')}</label>
              <input className="input" value={form.legal_last_name} onChange={(e) => update('legal_last_name', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">{t('form.preferred_name')}</label>
            <input className="input" value={form.preferred_name} onChange={(e) => update('preferred_name', e.target.value)} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('form.mobile_phone')}</label>
              <input className="input" type="tel" placeholder="+966 5X XXX XXXX" value={form.mobile_phone} onChange={(e) => update('mobile_phone', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('form.primary_email')}</label>
              <input className="input" type="email" value={form.primary_email} onChange={(e) => update('primary_email', e.target.value)} />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('form.arabic_fluency.label')}</label>
              <select className="input" value={form.arabic_fluency} onChange={(e) => update('arabic_fluency', e.target.value as FluencyLevel)}>
                {FLUENCY_OPTIONS.map(f => <option key={f} value={f}>{t(`form.fluency.${f}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('form.english_fluency.label')}</label>
              <select className="input" value={form.english_fluency} onChange={(e) => update('english_fluency', e.target.value as FluencyLevel)}>
                {FLUENCY_OPTIONS.map(f => <option key={f} value={f}>{t(`form.fluency.${f}`)}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <h2 className="serif font-bold text-2xl">{t('form.role')}</h2>
          {isLockedToJob ? (
            <div>
              <label className="label">{t('form.role')}</label>
              <div className="input bg-ink/5 text-ink font-semibold flex items-center justify-between">
                <span>{requisitions.find(r => r.id === form.job_requisition_id)?.title}</span>
                <span className="text-xs text-ink/50 font-normal">★</span>
              </div>
            </div>
          ) : (
            <div>
              <label className="label">{t('form.role')}</label>
              <select className="input" value={form.job_requisition_id} onChange={(e) => update('job_requisition_id', e.target.value)}>
                <option value="">{t('form.select_role')}</option>
                {requisitions.map((r) => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">{t('form.primary_practice_area.label')}</label>
            <select className="input" value={form.primary_practice_area} onChange={(e) => update('primary_practice_area', e.target.value as PracticeAreaCode)}>
              {PRACTICE_AREAS.map(p => <option key={p} value={p}>{t(`form.practice.${p}`)}</option>)}
            </select>
          </div>

          <div>
            <label className="label">{t('form.classification.label')}</label>
            <div className="grid grid-cols-2 gap-3">
              {(['W-2','1099'] as const).map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => update('classification_preference', c)}
                  className={`text-left card p-4 border-2 transition ${form.classification_preference === c ? 'border-accent bg-accent/5' : 'border-ink/10'}`}
                >
                  <div className="font-semibold text-sm">{t(`form.classification.${c}`)}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">{t('form.work_auth.label')}</label>
            <select className="input" value={form.work_auth_status} onChange={(e) => update('work_auth_status', e.target.value as WorkAuth)}>
              <option value="GCC National">{t('form.work_auth.GCC National')}</option>
              <option value="GCC Resident">{t('form.work_auth.GCC Resident')}</option>
              <option value="Permanent Resident">{t('form.work_auth.Permanent Resident')}</option>
              <option value="Work Visa Sponsored">{t('form.work_auth.Work Visa Sponsored')}</option>
              <option value="Citizen of Hiring Country">{t('form.work_auth.Citizen of Hiring Country')}</option>
              <option value="Requires Sponsorship">{t('form.work_auth.Requires Sponsorship')}</option>
            </select>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">{t('form.home_country')}</label>
              <select className="input" value={form.home_country_code} onChange={(e) => update('home_country_code', e.target.value)}>
                {COUNTRY_CODES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('form.home_city')}</label>
              <input className="input" value={form.home_city} onChange={(e) => update('home_city', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('form.home_postal')}</label>
              <input className="input" value={form.home_postal_code} onChange={(e) => update('home_postal_code', e.target.value)} />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('form.years_experience.label')}</label>
              <input className="input" type="number" min="0" max="60" value={form.years_experience} onChange={(e) => update('years_experience', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('form.years_audit_experience.label')}</label>
              <input className="input" type="number" min="0" max="60" value={form.years_audit_experience} onChange={(e) => update('years_audit_experience', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div>
            <label className="label">{t('form.cpa_track.label')}</label>
            <div className="grid grid-cols-2 gap-3">
              {([true, false] as const).map((v) => (
                <button
                  type="button"
                  key={String(v)}
                  onClick={() => update('cpa_track', v)}
                  className={`card p-3 border-2 text-sm font-semibold transition ${form.cpa_track === v ? 'border-accent bg-accent/5' : 'border-ink/10'}`}
                >{v ? t('form.cpa_track.yes') : t('form.cpa_track.no')}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">{t('form.licenses_held.label')}</label>
            <p className="text-xs text-ink/50 mb-2">{t('form.licenses_held.help')}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {LICENSE_OPTIONS.map((lic) => {
                const on = form.licenses_held.includes(lic)
                return (
                  <button
                    type="button"
                    key={lic}
                    onClick={() => toggleLicense(lic)}
                    className={`card p-2.5 border-2 text-xs font-semibold transition ${on ? 'border-accent bg-accent/5' : 'border-ink/10'}`}
                  >{t(`form.license.${lic}`)}</button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="label">{t('form.jurisdictions.label')}</label>
            <p className="text-xs text-ink/50 mb-2">{t('form.jurisdictions.help')}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {JURISDICTION_OPTIONS.map((jur) => {
                const on = form.jurisdictions_worked.includes(jur)
                return (
                  <button
                    type="button"
                    key={jur}
                    onClick={() => toggleJurisdiction(jur)}
                    className={`card p-2.5 border-2 text-xs font-semibold transition ${on ? 'border-accent bg-accent/5' : 'border-ink/10'}`}
                  >{t(`form.jurisdiction.${jur}`)}</button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="label">{t('form.resume.label')}</label>
            {!resumeFile ? (
              <div className="card p-5 border-2 border-dashed border-ink/20 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleResumeChange}
                  className="hidden"
                  id="resume-upload"
                />
                <label htmlFor="resume-upload" className="btn-ghost cursor-pointer inline-block">{t('form.resume.choose')}</label>
                <p className="mt-2 text-xs text-ink/50">{t('form.resume.help')}</p>
              </div>
            ) : (
              <div className="card p-3 border-2 border-accent/30 bg-accent/5 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-accent text-xl">≡</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{resumeFile.name}</div>
                    <div className="text-xs text-ink/50">{(resumeFile.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeResume}
                  className="text-sm font-semibold text-ink/60 hover:text-ink ms-3"
                >{t('form.resume.remove')}</button>
              </div>
            )}
            {resumeError && <div className="mt-2 text-xs text-red-600">{resumeError}</div>}
          </div>

          <div>
            <h2 className="serif font-bold text-xl">{t('form.source.label')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
              {(['walk_in','referral','linkedin','indeed','bayt','website','whatsapp','other'] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => update('source', s)}
                  className={`card p-3 border-2 text-sm font-semibold transition ${form.source === s ? 'border-accent bg-accent/5' : 'border-ink/10'}`}
                >{t(`form.source.${s}`)}</button>
              ))}
            </div>
          </div>

          <div className="mt-6 p-4 rounded-lg bg-slate-100 text-xs text-ink/70">
            {locale === 'ar'
              ? 'بإرسال هذا الطلب، أنت توافق على حفظ بياناتك بأمان والتواصل معك بشأن هذه الوظيفة. لا نبيع بياناتك لأي طرف ثالث.'
              : 'By submitting, you agree we can store your information securely and contact you about this role. We never sell your data.'}
          </div>

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
        </div>
      )}

      <div className="mt-8 flex justify-between items-center">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || isPending}
          className="btn-ghost disabled:opacity-30"
        >{t('form.back')}</button>

        {step < totalSteps ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(totalSteps, s + 1))}
            disabled={!canAdvance}
            className="btn-primary"
          >{t('form.continue')}</button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={isPending}
            className="btn-primary"
          >{isPending ? (resumeFile ? t('form.resume.uploading') : t('form.submitting')) : t('form.submit')}</button>
        )}
      </div>
    </div>
  )
}
