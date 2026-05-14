'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { strings, type Locale } from '@/lib/i18n/translations'
import { createWorkflow } from './actions'

export type ClientOption = {
  id: string
  name: string
  primary_contact_name: string | null
  primary_contact_email: string | null
}

export type TemplateOption = {
  id: string
  name: string
  description: string | null
}

export function StartWorkflowForm({
  locale,
  clients,
  templates,
  defaultTemplateId,
}: {
  locale: Locale
  clients: ClientOption[]
  templates: TemplateOption[]
  defaultTemplateId: string
}) {
  const router = useRouter()
  const t = (key: keyof typeof strings, vars?: Record<string, string | number>) => {
    const raw = strings[key]?.[locale] ?? strings[key]?.en ?? String(key)
    if (!vars) return raw
    return Object.entries(vars).reduce(
      (acc, [k, val]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(val)),
      raw,
    )
  }

  const [clientId, setClientId] = useState<string>(clients[0]?.id ?? '')
  const [templateId, setTemplateId] = useState<string>(defaultTemplateId)
  const [title, setTitle] = useState('')
  const [developerName, setDeveloperName] = useState(
    clients[0]?.primary_contact_name ?? '',
  )
  const [developerEmail, setDeveloperEmail] = useState(
    clients[0]?.primary_contact_email ?? '',
  )
  const [expiresDays, setExpiresDays] = useState<number>(7)
  const [notify, setNotify] = useState(true)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-fill the developer name/email when the client changes.
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clientId, clients],
  )

  function onClientChange(nextId: string) {
    setClientId(nextId)
    const next = clients.find((c) => c.id === nextId)
    if (next) {
      // Only overwrite if the user hasn't typed anything yet (or had auto-filled
      // a different client's contact). Heuristic: if the current value matches
      // the *previously selected* client's contact, we treat it as auto and
      // overwrite. Otherwise we leave the user's typed value alone.
      if (
        !developerName ||
        developerName === selectedClient?.primary_contact_name
      ) {
        setDeveloperName(next.primary_contact_name ?? '')
      }
      if (
        !developerEmail ||
        developerEmail === selectedClient?.primary_contact_email
      ) {
        setDeveloperEmail(next.primary_contact_email ?? '')
      }
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!clientId || !templateId || !title || !developerName || !developerEmail) {
      setError(t('workflows.start.error.required'))
      return
    }

    setSubmitting(true)
    try {
      const result = await createWorkflow({
        client_id: clientId,
        template_id: templateId,
        title,
        developer_name: developerName,
        developer_email: developerEmail,
        token_expires_days: Number.isFinite(expiresDays) ? expiresDays : 7,
        notify_developer: notify,
        notes: notes || undefined,
      })
      if (!result.ok || !result.run_id) {
        setError(result.error ?? t('workflows.start.error.create_failed'))
        setSubmitting(false)
        return
      }
      router.push(`/app/dms/workflows/${result.run_id}?created=1`)
    } catch (err) {
      console.error('[StartWorkflowForm] submit threw', err)
      setError(t('workflows.start.error.create_failed'))
      setSubmitting(false)
    }
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 bg-white border border-slate-200 rounded-xl p-6 shadow-sm"
    >
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Client + Template */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="client_id">
            {t('workflows.start.field.client')} *
          </label>
          <select
            id="client_id"
            name="client_id"
            required
            className={inputCls}
            value={clientId}
            onChange={(e) => onClientChange(e.target.value)}
          >
            <option value="">—</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="template_id">
            {t('workflows.start.field.template')} *
          </label>
          <select
            id="template_id"
            name="template_id"
            required
            className={inputCls}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">—</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Title */}
      <div>
        <label className={labelCls} htmlFor="title">
          {t('workflows.start.field.title')} *
        </label>
        <input
          id="title"
          name="title"
          required
          minLength={3}
          maxLength={200}
          className={inputCls}
          placeholder="STxxxx — Project name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Developer name + email */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="developer_name">
            {t('workflows.start.field.developer_name')} *
          </label>
          <input
            id="developer_name"
            name="developer_name"
            required
            maxLength={120}
            className={inputCls}
            value={developerName}
            onChange={(e) => setDeveloperName(e.target.value)}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="developer_email">
            {t('workflows.start.field.developer_email')} *
          </label>
          <input
            id="developer_email"
            name="developer_email"
            type="email"
            required
            className={inputCls}
            value={developerEmail}
            onChange={(e) => setDeveloperEmail(e.target.value)}
          />
        </div>
      </div>

      {/* Expiration days + notify checkbox */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
        <div>
          <label className={labelCls} htmlFor="token_expires_days">
            {t('workflows.start.field.expires_days')}
          </label>
          <input
            id="token_expires_days"
            name="token_expires_days"
            type="number"
            min={1}
            max={90}
            className={inputCls}
            value={expiresDays}
            onChange={(e) => {
              const n = Number(e.target.value)
              setExpiresDays(Number.isFinite(n) ? n : 7)
            }}
          />
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer select-none mb-2">
          <input
            type="checkbox"
            name="notify_developer"
            className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          {t('workflows.start.field.notify')}
        </label>
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls} htmlFor="notes">
          {t('workflows.start.field.notes')}
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitting
            ? t('workflows.start.submitting')
            : t('workflows.start.submit')}
        </button>
        <a
          href="/app/dms/workflows"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          {t('jobs.new.cancel')}
        </a>
      </div>
    </form>
  )
}
