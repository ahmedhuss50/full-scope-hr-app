'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { updateProject } from '../../edit-actions'

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
}

type ClientOpt = { id: string; company_name_ar: string }
type StaffOpt = { id: string; full_name: string; role_label: string }

const STATUS_OPTIONS: Array<{ value: 'active' | 'archived' | 'inactive'; label: string }> = [
  { value: 'active',   label: 'نشط' },
  { value: 'archived', label: 'مؤرشف' },
  { value: 'inactive', label: 'غير نشط' },
]

export function EditProjectInfo({
  project,
  clients,
  staff,
}: {
  project: Project
  clients: ClientOpt[]
  staff: StaffOpt[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState(project.code)
  const [nameAr, setNameAr] = useState(project.name_ar)
  const [developerId, setDeveloperId] = useState(project.developer_id)
  const [assignedId, setAssignedId] = useState<string>(project.assigned_employee_id ?? '')
  const [notes, setNotes] = useState(project.notes ?? '')
  const [status, setStatus] = useState<'active' | 'archived' | 'inactive'>(
    (project.status as 'active' | 'archived' | 'inactive') ?? 'active',
  )
  const [bankName, setBankName] = useState(project.bank_name ?? '')
  const [bankAccount, setBankAccount] = useState(project.bank_account ?? '')
  const [bankIban, setBankIban] = useState(project.bank_iban ?? '')

  function reset() {
    setCode(project.code)
    setNameAr(project.name_ar)
    setDeveloperId(project.developer_id)
    setAssignedId(project.assigned_employee_id ?? '')
    setNotes(project.notes ?? '')
    setStatus((project.status as 'active' | 'archived' | 'inactive') ?? 'active')
    setBankName(project.bank_name ?? '')
    setBankAccount(project.bank_account ?? '')
    setBankIban(project.bank_iban ?? '')
    setError(null)
  }

  async function onSave() {
    setError(null)
    setSaving(true)
    const res = await updateProject({
      project_id: project.id,
      code,
      name_ar: nameAr,
      developer_id: developerId,
      assigned_employee_id: assignedId || null,
      notes: notes || null,
      status,
      bank_name: bankName || null,
      bank_account: bankAccount || null,
      bank_iban: bankIban || null,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
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
          <label className="text-xs font-semibold text-slate-500 mb-1 block">الموظف المسؤول</label>
          <select className={inputCls} value={assignedId} onChange={(e) => setAssignedId(e.target.value)} disabled={saving}>
            <option value="">— غير محدد —</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} — {s.role_label}</option>)}
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
