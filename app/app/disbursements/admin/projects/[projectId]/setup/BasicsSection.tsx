'use client'

/**
 * BasicsSection — «الأساسيات» section of تهيئة المشروع.
 *
 * Client component. Renders a compact summary of the project's identity
 * (name, code, developer, status, notes) with a «تعديل» toggle that opens
 * an inline edit form. Wraps the existing `updateProject` server action —
 * no new backend needed for slice 1.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, X } from 'lucide-react'
import { updateProject } from '../../../edit-actions'

type Project = {
  id: string
  code: string
  name_ar: string
  developer_id: string
  status: string | null
  notes: string | null
  // Passed through so we don't nuke bank/checklist state on save.
  bank_name: string | null
  bank_account: string | null
  bank_iban: string | null
  checklist_template_id: string | null
  assigned_employee_id: string | null
}
type ClientOpt = { id: string; company_name_ar: string }

const STATUS_OPTIONS: Array<{ value: 'active' | 'archived' | 'inactive'; label: string }> = [
  { value: 'active',   label: 'نشط' },
  { value: 'archived', label: 'مؤرشف' },
  { value: 'inactive', label: 'غير نشط' },
]

function statusLabel(v: string | null): string {
  return STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v ?? '—'
}

export function BasicsSection({
  project,
  developerName,
  clients,
}: {
  project: Project
  developerName: string | null
  clients: ClientOpt[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [code, setCode] = useState(project.code)
  const [nameAr, setNameAr] = useState(project.name_ar)
  const [developerId, setDeveloperId] = useState(project.developer_id)
  const [notes, setNotes] = useState(project.notes ?? '')
  const [status, setStatus] = useState<'active' | 'archived' | 'inactive'>(
    (project.status as 'active' | 'archived' | 'inactive') ?? 'active',
  )

  function reset() {
    setCode(project.code)
    setNameAr(project.name_ar)
    setDeveloperId(project.developer_id)
    setNotes(project.notes ?? '')
    setStatus((project.status as 'active' | 'archived' | 'inactive') ?? 'active')
    setError(null)
  }

  async function onSave() {
    setError(null)
    setSaving(true)
    // Pass through the fields we're not editing here so the server action
    // doesn't clear them. updateProject accepts the full row.
    const res = await updateProject({
      project_id: project.id,
      code: code.trim(),
      name_ar: nameAr.trim(),
      developer_id: developerId,
      assigned_employee_id: project.assigned_employee_id,
      notes: notes.trim() || null,
      status,
      bank_name: project.bank_name,
      bank_account: project.bank_account,
      bank_iban: project.bank_iban,
      checklist_template_id: project.checklist_template_id,
    })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  if (!open) {
    return (
      <>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm min-w-0 flex-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <dt className="text-slate-500 text-xs">الاسم:</dt>
              <dd className="font-semibold text-slate-900 truncate">{project.name_ar}</dd>
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <dt className="text-slate-500 text-xs">الرمز:</dt>
              <dd className="font-mono text-slate-800 truncate" dir="ltr">{project.code}</dd>
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <dt className="text-slate-500 text-xs">العميل:</dt>
              <dd className="text-slate-800 truncate">{developerName ?? '—'}</dd>
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <dt className="text-slate-500 text-xs">الحالة:</dt>
              <dd className="text-slate-800">{statusLabel(project.status)}</dd>
            </div>
            {project.notes && (
              <div className="sm:col-span-2 flex items-baseline gap-2 min-w-0">
                <dt className="text-slate-500 text-xs">ملاحظات:</dt>
                <dd className="text-slate-700 truncate">{project.notes}</dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            تعديل
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم المشروع *</label>
          <input className={inputCls} value={nameAr} onChange={(e) => setNameAr(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رمز المشروع *</label>
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">العميل *</label>
          <select className={inputCls} value={developerId} onChange={(e) => setDeveloperId(e.target.value)} disabled={saving}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name_ar}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">الحالة</label>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'archived' | 'inactive')} disabled={saving}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-slate-500 mb-1 block">ملاحظات</label>
          <textarea rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
        </div>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          إلغاء
        </button>
      </div>
    </div>
  )
}
