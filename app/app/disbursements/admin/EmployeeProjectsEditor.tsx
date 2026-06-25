'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FolderKanban } from 'lucide-react'
import { setEmployeeProjects } from './edit-actions'

// Mirrors the option shape used by the new-employee form. Kept local so
// the admin list page doesn't take a hard dependency on the new-employee
// directory's exports.
export type ProjectPickerOption = {
  id: string
  code: string
  name_ar: string
  developer_id: string | null
  developer_name: string | null
}

/**
 * Owner-only inline editor for the projects assigned to a single
 * employee. Opens as a panel under the employee's row. The current
 * assignments come in pre-loaded from the server so the editor doesn't
 * need a separate fetch.
 */
export function EmployeeProjectsEditor({
  userId,
  fullName,
  initialProjectIds,
  projects,
}: {
  userId: string
  fullName: string
  initialProjectIds: string[]
  projects: ProjectPickerOption[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialProjectIds))
  const [query, setQuery] = useState('')

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
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
  }, [projects, query])

  const projectById = useMemo(() => {
    const m = new Map<string, ProjectPickerOption>()
    for (const p of projects) m.set(p.id, p)
    return m
  }, [projects])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function remove(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function reset() {
    setSelected(new Set(initialProjectIds))
    setError(null)
    setQuery('')
  }

  async function onSave() {
    setError(null)
    setSaving(true)
    const res = await setEmployeeProjects({
      user_id: userId,
      project_ids: Array.from(selected),
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
        onClick={() => { setOpen(true); setError(null) }}
        title={`تعديل مشاريع ${fullName}`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
      >
        <FolderKanban className="w-3.5 h-3.5" aria-hidden="true" />
        تعديل المشاريع
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full bg-teal-50 text-teal-700 text-[10px] font-bold font-mono">
          {initialProjectIds.length}
        </span>
      </button>
    )
  }

  const selectedIds = Array.from(selected)

  return (
    <div className="w-full rounded-lg border border-teal-200 bg-white p-3 space-y-2 mt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-700">
          مشاريع {fullName}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center px-3 py-1 rounded-md bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
          >
            {saving ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
          <button
            type="button"
            onClick={() => { reset(); setOpen(false) }}
            disabled={saving}
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-xs text-slate-500 px-1 py-3">لا توجد مشاريع متاحة بعد.</div>
      ) : (
        <div className="rounded border border-slate-200">
          {selectedIds.length > 0 && (
            <div className="px-2 py-1.5 border-b border-slate-100 flex flex-wrap gap-1">
              {selectedIds.map((id) => {
                const p = projectById.get(id)
                if (!p) return null
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 ring-1 ring-teal-200 text-[11px] font-semibold"
                  >
                    <span className="font-mono">{p.code}</span>
                    <button
                      type="button"
                      onClick={() => remove(id)}
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
          <div className="px-2 py-1.5 border-b border-slate-100">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث…"
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
            {grouped.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-500">لا توجد نتائج.</div>
            ) : (
              grouped.map((g) => (
                <div key={g.devName} className="px-2 py-1.5 space-y-1">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    {g.devName}
                  </div>
                  <div className="space-y-0.5">
                    {g.items.map((p) => {
                      const checked = selected.has(p.id)
                      return (
                        <label
                          key={p.id}
                          className={`flex items-start gap-2 px-1.5 py-0.5 rounded cursor-pointer text-xs ${
                            checked ? 'bg-teal-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(p.id)}
                            className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="font-mono text-[11px] text-slate-500">{p.code}</span>
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
      )}
    </div>
  )
}
