'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createEmployee, type CreateEmployeeRole } from './actions'

// Owner is intentionally absent from the picker for assignment — owners
// see everything regardless, so an "assign to projects" UI doesn't apply.
// But we still allow setting their role to owner via the dropdown.
export type ProjectPickerOption = {
  id: string
  code: string
  name_ar: string
  developer_id: string | null
  developer_name: string | null
}

const ROLE_OPTIONS: ReadonlyArray<{ value: CreateEmployeeRole; label: string; hint: string }> = [
  { value: 'employee',   label: 'مراجع',  hint: 'يراجع السندات في صندوقه ويعتمدها' },
  { value: 'supervisor', label: 'مشرف',  hint: 'يعتمد ما اعتمده المراجعون قبل التوقيع' },
  { value: 'owner',      label: 'مدير',   hint: 'يطّلع على كل المشاريع ويوقّع نهائيًا' },
  { value: 'viewer',     label: 'مشاهد', hint: 'قراءة فقط — بدون تعديل أو اعتماد' },
  { value: 'deliverer',  label: 'مسلِّم',  hint: 'يسجّل تسليم السندات الموقّعة' },
]

export function NewEmployeeForm({ projects }: { projects: ProjectPickerOption[] }) {
  const router = useRouter()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [sendInvite, setSendInvite] = useState(true)
  const [role, setRole] = useState<CreateEmployeeRole>('employee')
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())
  const [projectQuery, setProjectQuery] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackLink, setFallbackLink] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  // Group projects by developer for readability. Unassigned projects fall
  // under a "بدون عميل" bucket.
  const grouped = useMemo(() => {
    const q = projectQuery.trim().toLowerCase()
    const filtered = q
      ? projects.filter((p) =>
          p.code.toLowerCase().includes(q) ||
          p.name_ar.toLowerCase().includes(q) ||
          (p.developer_name ?? '').toLowerCase().includes(q),
        )
      : projects
    const byDev = new Map<string, { devName: string; items: ProjectPickerOption[] }>()
    for (const p of filtered) {
      const key = p.developer_id ?? '__none__'
      const devName = p.developer_name ?? 'بدون عميل'
      if (!byDev.has(key)) byDev.set(key, { devName, items: [] })
      byDev.get(key)!.items.push(p)
    }
    return Array.from(byDev.values()).sort((a, b) => a.devName.localeCompare(b.devName, 'ar'))
  }, [projects, projectQuery])

  // Reverse lookup: id → option (for the selected-chip strip).
  const projectById = useMemo(() => {
    const m = new Map<string, ProjectPickerOption>()
    for (const p of projects) m.set(p.id, p)
    return m
  }, [projects])

  function toggleProject(id: string) {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function removeProject(id: string) {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFallbackLink(null)
    setWarning(null)

    if (!fullName.trim() || !email.trim()) {
      setError('الرجاء تعبئة جميع الحقول المطلوبة.')
      return
    }

    setSubmitting(true)
    try {
      const res = await createEmployee({
        full_name: fullName.trim(),
        email: email.trim(),
        job_title: jobTitle.trim() || null,
        notes: notes.trim() || null,
        send_invite: sendInvite,
        dsb_role: role,
        // Owners aren't assigned to specific projects.
        project_ids: role === 'owner' ? [] : Array.from(selectedProjectIds),
      })
      if (!res.ok) {
        setError(res.error)
        setSubmitting(false)
        return
      }
      if (res.fallback_link || res.warning) {
        setFallbackLink(res.fallback_link ?? null)
        setWarning(res.warning ?? null)
        setSubmitting(false)
        setTimeout(
          () => router.push('/app/disbursements/admin?created=employee'),
          900,
        )
        return
      }
      router.push('/app/disbursements/admin?created=employee')
    } catch (err) {
      console.error('[NewEmployeeForm] submit threw', err)
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء الموظف.')
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

      {warning && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {warning}
        </div>
      )}

      {fallbackLink && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900 space-y-1">
          <div className="font-semibold">رابط الدعوة (انسخه وأرسله):</div>
          <div className="font-mono text-xs break-all bg-white border border-teal-100 rounded p-2">
            {fallbackLink}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="full_name">
            الاسم الكامل *
          </label>
          <input
            id="full_name"
            required
            className={inputCls}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="email">
            البريد الإلكتروني *
          </label>
          <input
            id="email"
            type="email"
            required
            dir="ltr"
            className={inputCls + ' text-left'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={320}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="dsb_role">
            المسمى الوظيفي *
          </label>
          <select
            id="dsb_role"
            className={inputCls}
            value={role}
            onChange={(e) => setRole(e.target.value as CreateEmployeeRole)}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            {ROLE_OPTIONS.find((o) => o.value === role)?.hint}
          </p>
        </div>
        <div>
          <label className={labelCls} htmlFor="job_title">
            المسمى الإضافي (اختياري)
          </label>
          <input
            id="job_title"
            className={inputCls}
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            maxLength={200}
            placeholder="مثلاً: محاسب أول"
          />
        </div>
      </div>

      {/* Project assignment — hidden for owners since they see everything. */}
      <div>
        <label className={labelCls}>المشاريع المسؤول عنها</label>
        {role === 'owner' ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            المدير يطّلع على جميع المشاريع — لا حاجة لتخصيص قائمة.
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            لا توجد مشاريع بعد. يمكنك إنشاء الموظف الآن وإسناده للمشاريع لاحقًا من صفحة المشروع.
          </div>
        ) : (
          <ProjectMultiSelect
            grouped={grouped}
            selected={selectedProjectIds}
            onToggle={toggleProject}
            onRemove={removeProject}
            projectById={projectById}
            query={projectQuery}
            onQueryChange={setProjectQuery}
          />
        )}
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">
          ملاحظات
        </label>
        <textarea
          id="notes"
          rows={3}
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={sendInvite}
          onChange={(e) => setSendInvite(e.target.checked)}
          className="mt-1 w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-sm text-slate-700">إنشاء حساب دخول للموظف</span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitting ? 'جارٍ الإنشاء…' : 'إنشاء الموظف'}
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

// ---------------------------------------------------------------------------
// ProjectMultiSelect — checkbox list grouped by developer, with search and
// removable chips for the current selection. Used in the create form and
// (re-exported via this module so other admin surfaces can reuse it if we
// extract later — for now it's local).
// ---------------------------------------------------------------------------

function ProjectMultiSelect({
  grouped,
  selected,
  onToggle,
  onRemove,
  projectById,
  query,
  onQueryChange,
}: {
  grouped: Array<{ devName: string; items: ProjectPickerOption[] }>
  selected: Set<string>
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  projectById: Map<string, ProjectPickerOption>
  query: string
  onQueryChange: (q: string) => void
}) {
  const selectedIds = Array.from(selected)

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {/* Selected chips */}
      {selectedIds.length > 0 && (
        <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const p = projectById.get(id)
            if (!p) return null
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 ring-1 ring-teal-200 text-[11px] font-semibold"
              >
                <span className="font-mono">{p.code}</span>
                <span className="text-teal-700">·</span>
                <span className="truncate max-w-[12rem]">{p.name_ar}</span>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  className="ms-1 text-teal-700 hover:text-teal-900"
                  aria-label="إزالة"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 border-b border-slate-100">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="ابحث عن مشروع بالاسم أو الرمز أو اسم العميل…"
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
      </div>

      {/* Grouped list */}
      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
        {grouped.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">لا توجد نتائج.</div>
        ) : (
          grouped.map((g) => (
            <div key={g.devName} className="px-3 py-2 space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                {g.devName}
              </div>
              <div className="space-y-1">
                {g.items.map((p) => {
                  const checked = selected.has(p.id)
                  return (
                    <label
                      key={p.id}
                      className={`flex items-start gap-2 px-2 py-1 rounded cursor-pointer text-sm ${
                        checked ? 'bg-teal-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(p.id)}
                        className="mt-1 w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-xs text-slate-500">{p.code}</span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span className="text-slate-800">{p.name_ar}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
