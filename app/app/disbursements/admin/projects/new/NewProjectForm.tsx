'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProject } from './actions'

export type EmployeeOption = { id: string; full_name: string; role_label?: string }
export type DeveloperOption = { id: string; company_name_ar: string }

export function NewProjectForm({
  suggestedCode,
  employees,
  developers,
  defaultDeveloperId,
}: {
  suggestedCode: string
  employees: EmployeeOption[]
  developers: DeveloperOption[]
  defaultDeveloperId?: string | null
}) {
  const router = useRouter()

  const [code, setCode] = useState(suggestedCode)
  const [nameAr, setNameAr] = useState('')
  const [developerId, setDeveloperId] = useState<string>(defaultDeveloperId ?? '')
  const [assignedId, setAssignedId] = useState<string>('')
  const [notes, setNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!code.trim() || !nameAr.trim() || !developerId) {
      setError('الرجاء تعبئة جميع الحقول المطلوبة.')
      return
    }

    setSubmitting(true)
    try {
      const res = await createProject({
        code: code.trim(),
        name_ar: nameAr.trim(),
        developer_id: developerId,
        assigned_employee_id: assignedId || null,
        notes: notes.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
        setSubmitting(false)
        return
      }
      router.push('/app/disbursements/admin?created=project')
    } catch (err) {
      console.error('[NewProjectForm] submit threw', err)
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء المشروع.')
      setSubmitting(false)
    }
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <form onSubmit={onSubmit} className="space-y-5 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="developer_id">العميل *</label>
        <select
          id="developer_id"
          required
          className={inputCls}
          value={developerId}
          onChange={(e) => setDeveloperId(e.target.value)}
        >
          <option value="">— اختر العميل —</option>
          {developers.map((d) => (
            <option key={d.id} value={d.id}>{d.company_name_ar}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelCls} htmlFor="code">رمز المشروع *</label>
          <input
            id="code"
            required
            dir="ltr"
            className={inputCls + ' text-left font-mono'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={32}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="name_ar">اسم المشروع *</label>
          <input
            id="name_ar"
            required
            className={inputCls}
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            maxLength={200}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="assigned">الموظف المسؤول</label>
        <select
          id="assigned"
          className={inputCls}
          value={assignedId}
          onChange={(e) => setAssignedId(e.target.value)}
        >
          <option value="">— غير محدد —</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.role_label ? `${emp.full_name} — ${emp.role_label}` : emp.full_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">ملاحظات</label>
        <textarea
          id="notes"
          rows={3}
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitting ? 'جارٍ الإنشاء…' : 'إنشاء المشروع'}
        </button>
        <a
          href="/app/disbursements/admin"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          إلغاء
        </a>
      </div>
    </form>
  )
}
