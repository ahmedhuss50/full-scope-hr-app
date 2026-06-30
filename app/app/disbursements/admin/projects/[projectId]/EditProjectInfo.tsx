'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { updateProject, setProjectEmployees } from '../../edit-actions'

type Project = {
  id: string
  code: string
  name_ar: string
  developer_id: string
  assigned_employee_id: string | null
  notes: string | null
  status: string | null
  bank_name?: string | null
  bank_account?: string | null
  bank_iban?: string | null
  checklist_template_id?: string | null
}

type ClientOpt = { id: string; company_name_ar: string }
type StaffOpt = { id: string; full_name: string; role_label: string }
type TemplateOpt = { id: string; label: string }

const STATUS_OPTIONS: Array<{ value: 'active' | 'archived' | 'inactive'; label: string }> = [
  { value: 'active',   label: 'نشط' },
  { value: 'archived', label: 'مؤرشف' },
  { value: 'inactive', label: 'غير نشط' },
]

export function EditProjectInfo({
  project,
  clients,
  staff,
  assignedUserIds,
  canEditAssignees,
  checklistTemplates,
}: {
  project: Project
  clients: ClientOpt[]
  staff: StaffOpt[]
  // Pre-loaded list of users currently in dsb_project_employees for this
  // project. The picker uses this for pre-checked state.
  assignedUserIds: string[]
  // Only owners can edit the assignee list. Non-owners see the metadata
  // fields but the project assignees section is hidden.
  canEditAssignees: boolean
  // All checklist templates in the tenant. Used for the "قائمة المراجعة"
  // dropdown.
  checklistTemplates: TemplateOpt[]
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
  const [bankName, setBankName] = useState(project.bank_name ?? '')
  const [bankAccount, setBankAccount] = useState(project.bank_account ?? '')
  const [bankIban, setBankIban] = useState(project.bank_iban ?? '')
  // '' = inherit (fall back to client / tenant default); otherwise a template id.
  const [checklistTemplateId, setChecklistTemplateId] = useState<string>(
    project.checklist_template_id ?? '',
  )

  // Multi-assignee picker state. Excludes owners — owners see everything
  // already; placing them in the junction adds noise without changing access.
  const assignableStaff = useMemo(
    () => staff.filter((s) => s.role_label !== 'مدير'),
    [staff],
  )
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    () => new Set(assignedUserIds),
  )

  function toggleUser(id: string) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function reset() {
    setCode(project.code)
    setNameAr(project.name_ar)
    setDeveloperId(project.developer_id)
    setNotes(project.notes ?? '')
    setStatus((project.status as 'active' | 'archived' | 'inactive') ?? 'active')
    setBankName(project.bank_name ?? '')
    setBankAccount(project.bank_account ?? '')
    setBankIban(project.bank_iban ?? '')
    setChecklistTemplateId(project.checklist_template_id ?? '')
    setSelectedUserIds(new Set(assignedUserIds))
    setError(null)
  }

  async function onSave() {
    setError(null)
    setSaving(true)

    // updateProject still carries the legacy single-pointer column for
    // compatibility. We send the FIRST selected user (or null) as the
    // "primary" assignee. setProjectEmployees, called next, will overwrite
    // this with its own logic, but doing both keeps the row consistent if
    // either call fails partway through.
    const ids = Array.from(selectedUserIds)
    const primary = ids[0] ?? null

    const res = await updateProject({
      project_id: project.id,
      code,
      name_ar: nameAr,
      developer_id: developerId,
      assigned_employee_id: primary,
      notes: notes || null,
      status,
      bank_name: bankName || null,
      bank_account: bankAccount || null,
      bank_iban: bankIban || null,
      // '' means "inherit" — send null so the server clears any existing
      // pointer. A populated value points the project at that template.
      checklist_template_id: checklistTemplateId === '' ? null : checklistTemplateId,
    })
    if (!res.ok) {
      setSaving(false)
      setError(res.error)
      return
    }

    // Only owners can change the assignee list; skip this call otherwise
    // so non-owners don't get a permission error after a successful info
    // save.
    if (canEditAssignees) {
      const assignRes = await setProjectEmployees({
        project_id: project.id,
        user_ids: ids,
      })
      if (!assignRes.ok) {
        setSaving(false)
        setError(assignRes.error)
        return
      }
    }

    setSaving(false)
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        تعديل البيانات
      </button>
    )
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <section className="bg-white border border-teal-200 rounded-xl shadow-sm p-5 space-y-3">
      <h3 className="serif font-bold text-base text-slate-900">تعديل بيانات المشروع</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رمز المشروع *</label>
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم المشروع *</label>
          <input className={inputCls} value={nameAr} onChange={(e) => setNameAr(e.target.value)} disabled={saving} />
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
          <textarea rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
        </div>
      </div>

      {/* Multi-employee picker — owner-only. */}
      {canEditAssignees && (
        <div className="pt-3 border-t border-slate-100 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="serif font-bold text-sm text-slate-900">الموظفون المسؤولون</h4>
            <span className="text-[11px] text-slate-500">
              {selectedUserIds.size} موظف مختار
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            أي موظف مُسند يمكنه اعتماد طلبات هذا المشروع في مرحلة &quot;بانتظار الموظف&quot;،
            وتصله الإشعارات عند رفع سند جديد. المدير يطّلع على كل المشاريع بدون
            إسناد.
          </p>
          {assignableStaff.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              لا يوجد موظفون قابلون للإسناد بعد.
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 max-h-56 overflow-y-auto divide-y divide-slate-100">
              {assignableStaff.map((s) => {
                const checked = selectedUserIds.has(s.id)
                return (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${
                      checked ? 'bg-teal-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleUser(s.id)}
                      disabled={saving}
                      className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-800">
                      {s.full_name}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 ring-1 ring-slate-200 text-[10px] font-semibold shrink-0">
                      {s.role_label}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="pt-3 border-t border-slate-100 space-y-2">
        <h4 className="serif font-bold text-sm text-slate-900">قائمة المراجعة</h4>
        <p className="text-[11px] text-slate-500">
          القائمة التي تظهر للموظف عند مراجعة سندات هذا المشروع. اتركها على
          «افتراضي» لاستخدام قائمة العميل أو القائمة الافتراضية للمكتب.
        </p>
        <select
          className={inputCls}
          value={checklistTemplateId}
          onChange={(e) => setChecklistTemplateId(e.target.value)}
          disabled={saving}
        >
          <option value="">افتراضي (يستخدم قائمة العميل أو القائمة الافتراضية للمكتب)</option>
          {checklistTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="pt-3 border-t border-slate-100 space-y-2">
        <h4 className="serif font-bold text-sm text-slate-900">حساب المشروع (حساب الضمان)</h4>
        <p className="text-[11px] text-slate-500">الحساب البنكي المخصّص لهذا المشروع — تخرج منه المبالغ المصروفة.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم البنك</label>
            <input className={inputCls} value={bankName} onChange={(e) => setBankName(e.target.value)} disabled={saving} placeholder="مثلاً: بنك البلاد" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم الحساب</label>
            <input className={inputCls} value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} disabled={saving} dir="ltr" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">الآيبان</label>
            <input className={inputCls} value={bankIban} onChange={(e) => setBankIban(e.target.value.toUpperCase())} disabled={saving} dir="ltr" placeholder="SA__ ____ ____ ____ ____ ____" />
          </div>
        </div>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50">
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button type="button" onClick={() => { reset(); setOpen(false) }} disabled={saving} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
          إلغاء
        </button>
      </div>
    </section>
  )
}
