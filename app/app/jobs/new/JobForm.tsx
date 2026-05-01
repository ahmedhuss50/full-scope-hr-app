'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { strings, type Locale } from '@/lib/i18n/translations'
import { createJob } from './actions'

type Ref = { id: string; name: string | null; code?: string | null }

export function JobForm({
  locale,
  departments,
  practiceAreas,
  workLocations,
}: {
  locale: Locale
  departments: Ref[]
  practiceAreas: Ref[]
  workLocations: Ref[]
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = (key: keyof typeof strings) =>
    strings[key]?.[locale] ?? strings[key]?.en ?? String(key)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    const result = await createJob(formData)
    setSubmitting(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    router.push('/app/jobs')
    router.refresh()
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <form onSubmit={onSubmit} className="space-y-5 bg-white border border-slate-200 rounded-lg p-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="title">{t('jobs.new.field.title')} *</label>
        <input id="title" name="title" required className={inputCls} placeholder="Tax Accountant" />
      </div>

      <div>
        <label className={labelCls} htmlFor="description">{t('jobs.new.field.description')}</label>
        <textarea id="description" name="description" className={inputCls} rows={4} placeholder="Brief role summary, responsibilities, qualifications..." />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="department_id">{t('jobs.new.field.department')}</label>
          <select id="department_id" name="department_id" className={inputCls}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name ?? d.id}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="practice_area_id">{t('jobs.new.field.practice_area')}</label>
          <select id="practice_area_id" name="practice_area_id" className={inputCls}>
            <option value="">—</option>
            {practiceAreas.map((p) => (
              <option key={p.id} value={p.id}>{p.name ?? p.code ?? p.id}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="work_location_id">{t('jobs.new.field.work_location')}</label>
          <select id="work_location_id" name="work_location_id" className={inputCls}>
            <option value="">—</option>
            {workLocations.map((w) => (
              <option key={w.id} value={w.id}>{w.name ?? w.id}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="classification">{t('jobs.new.field.classification')} *</label>
          <select id="classification" name="classification" required defaultValue="W-2" className={inputCls}>
            <option value="W-2">W-2 (Employee)</option>
            <option value="1099">1099 (Contractor)</option>
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="pay_type">{t('jobs.new.field.pay_type')}</label>
          <select id="pay_type" name="pay_type" className={inputCls}>
            <option value="">—</option>
            <option value="Salary">Salary</option>
            <option value="Hourly">Hourly</option>
            <option value="Commission">Commission</option>
            <option value="Retainer">Retainer</option>
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="status">{t('jobs.new.field.status')} *</label>
          <select id="status" name="status" required defaultValue="open" className={inputCls}>
            <option value="open">Open</option>
            <option value="on_hold">On hold</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="pay_rate_min">{t('jobs.new.field.pay_min')}</label>
          <input id="pay_rate_min" name="pay_rate_min" type="number" step="0.01" min="0" className={inputCls} placeholder="8000" />
        </div>

        <div>
          <label className={labelCls} htmlFor="pay_rate_max">{t('jobs.new.field.pay_max')}</label>
          <input id="pay_rate_max" name="pay_rate_max" type="number" step="0.01" min="0" className={inputCls} placeholder="14000" />
        </div>

        <div>
          <label className={labelCls} htmlFor="pay_currency">{t('jobs.new.field.pay_currency')}</label>
          <input id="pay_currency" name="pay_currency" defaultValue="SAR" maxLength={4} className={inputCls} />
        </div>

        <div>
          <label className={labelCls} htmlFor="openings_count">{t('jobs.new.field.openings')}</label>
          <input id="openings_count" name="openings_count" type="number" min="1" defaultValue="1" className={inputCls} />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {submitting ? t('jobs.new.submitting') : t('jobs.new.submit')}
        </button>
        <a href="/app/jobs" className="rounded-md px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          {t('jobs.new.cancel')}
        </a>
      </div>
    </form>
  )
}
