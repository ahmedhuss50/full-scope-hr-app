'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserCog } from 'lucide-react'
import { changeEmployeeRole } from './edit-actions'

type StaffRole = 'employee' | 'supervisor' | 'owner' | 'viewer' | 'deliverer'

const ROLE_LABEL: Record<StaffRole, string> = {
  employee:   'مراجع',
  supervisor: 'مشرف',
  owner:      'مدير',
  viewer:     'مشاهد',
  deliverer:  'مسلِّم',
}

/**
 * Owner-only inline role changer. Shows a button that expands into a small
 * three-option picker. Selecting a new role calls changeEmployeeRole and
 * refreshes the page. Safety rails (no self-change, no last-owner demote)
 * are enforced server-side.
 */
export function ChangeRoleButton({
  userId,
  fullName,
  currentRole,
}: {
  userId: string
  fullName: string
  currentRole: StaffRole
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(role: StaffRole) {
    setError(null)
    if (role === currentRole) {
      setOpen(false)
      return
    }
    setSaving(true)
    const res = await changeEmployeeRole({ user_id: userId, new_role: role })
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
      <div className="inline-flex flex-col items-stretch gap-1">
        <button
          type="button"
          onClick={() => { setOpen(true); setError(null) }}
          title={`تغيير دور ${fullName}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          <UserCog className="w-3.5 h-3.5" aria-hidden="true" />
          تغيير الدور
        </button>
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
            {error}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="inline-flex flex-col items-stretch gap-1.5">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">اختر الدور الجديد</div>
      <div className="inline-flex items-center gap-1.5 flex-wrap">
        {(['employee', 'supervisor', 'owner', 'viewer', 'deliverer'] as StaffRole[]).map((role) => {
          const isCurrent = role === currentRole
          return (
            <button
              key={role}
              type="button"
              onClick={() => pick(role)}
              disabled={saving || isCurrent}
              className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border transition disabled:opacity-50 ${
                isCurrent
                  ? 'border-teal-300 bg-teal-50 text-teal-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {isCurrent ? `✓ ${ROLE_LABEL[role]} (الحالي)` : ROLE_LABEL[role]}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null) }}
          disabled={saving}
          className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
