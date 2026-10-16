'use client'

/**
 * EditEmployeeDialog — owner-only full-field editor for a user row. Covers
 * everything on the dsb_role-restricted employee listing that wasn't editable
 * before: full_name, phone, active flag. Role is still edited via its own
 * ChangeRoleButton (different auth guards + last-owner protection). Email is
 * read-only here — see updateEmployeeInfo for the rationale.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, X, Loader2 } from 'lucide-react'
import { updateEmployeeInfo } from './edit-actions'

export interface EditableEmployee {
  id: string
  full_name: string
  email: string
  phone: string | null
  active: boolean
  dsb_role: string | null
}

export function EditEmployeeDialog({ employee }: { employee: EditableEmployee }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [fullName, setFullName] = useState(employee.full_name)
  const [phone, setPhone]       = useState(employee.phone ?? '')
  const [active, setActive]     = useState(employee.active)

  async function onSave() {
    setErr(null)
    setBusy(true)
    const res = await updateEmployeeInfo({
      user_id: employee.id,
      full_name: fullName,
      phone,
      active,
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'
  const labelCls = 'text-xs font-semibold text-slate-600 mb-1 block'

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="تعديل بيانات الموظف"
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-teal-700 hover:bg-slate-100"
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 py-8 px-4" dir="rtl">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="serif font-bold text-lg text-slate-900">تعديل بيانات الموظف</h3>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className={labelCls}>الاسم الكامل *</label>
            <input className={inputCls} value={fullName}
              onChange={(e) => setFullName(e.target.value)} disabled={busy} autoFocus maxLength={200} />
          </div>
          <div>
            <label className={labelCls}>البريد الإلكتروني (للعرض فقط)</label>
            <input className={inputCls + ' bg-slate-50'} value={employee.email} disabled dir="ltr" />
            <div className="text-[11px] text-slate-500 mt-1">
              لتغيير البريد: احذف الحساب وأعد إنشاءه بالبريد الجديد.
            </div>
          </div>
          <div>
            <label className={labelCls}>رقم الجوال</label>
            <input className={inputCls} value={phone}
              onChange={(e) => setPhone(e.target.value)} disabled={busy} dir="ltr" maxLength={30} />
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                checked={active} onChange={(e) => setActive(e.target.checked)} disabled={busy} />
              <span className="text-sm font-semibold text-slate-800">حساب نشط</span>
            </label>
            <div className="text-[11px] text-slate-500 mt-1 pr-6">
              تعطيل الحساب يمنع الموظف من تسجيل الدخول دون حذف بياناته.
            </div>
          </div>

          {err && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 font-semibold">
              {err}
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <button type="button" onClick={onSave} disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy}
              className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
