'use client'

/**
 * Row-selection context — lightweight shared state for per-row checkbox UIs
 * on the admin list pages. The server page passes the full list of visible
 * ids (the FILTERED set, not just the current page) and the three primitives
 * below (RowCheckbox, SelectAllCheckbox, SelectionActionBar) read/write
 * selection through this context.
 *
 * Delete action is per-entity — pass the bulk-delete server action in via
 * SelectionProvider so the bar can call it without importing from
 * entity-specific modules.
 */
import { createContext, useCallback, useContext, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, X } from 'lucide-react'

type DeleteResult = { ok: true; deleted: number } | { ok: false; error: string }

export type SelectionDeleteFn = (ids: string[]) => Promise<DeleteResult>

interface SelectionCtx {
  allIds: string[]
  selected: Set<string>
  toggle: (id: string) => void
  toggleAll: () => void
  clear: () => void
  isSelected: (id: string) => boolean
  entityLabel: { noun: string; many: string }
  onDelete: SelectionDeleteFn
}

const Ctx = createContext<SelectionCtx | null>(null)

export function SelectionProvider({
  allIds,
  entityLabel,
  onDelete,
  children,
}: {
  /** Every row id visible on the current filtered view (across pages). */
  allIds: string[]
  entityLabel: { noun: string; many: string }
  /** Bulk-delete server action for this entity. */
  onDelete: SelectionDeleteFn
  children: React.ReactNode
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      // If everything is already selected → clear; otherwise select all visible.
      if (prev.size === allIds.length && allIds.every((id) => prev.has(id))) {
        return new Set()
      }
      return new Set(allIds)
    })
  }, [allIds])
  const clear = useCallback(() => setSelected(new Set()), [])
  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  const value = useMemo<SelectionCtx>(
    () => ({ allIds, selected, toggle, toggleAll, clear, isSelected, entityLabel, onDelete }),
    [allIds, selected, toggle, toggleAll, clear, isSelected, entityLabel, onDelete],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useSelection(): SelectionCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSelection must be used inside <SelectionProvider>')
  return ctx
}

/**
 * Checkbox for a single row — plug this into the leftmost cell of each row.
 */
export function RowCheckbox({ id }: { id: string }) {
  const { toggle, isSelected } = useSelection()
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
      checked={isSelected(id)}
      onChange={() => toggle(id)}
      aria-label="تحديد الصف"
    />
  )
}

/**
 * Header checkbox — toggle-all with an indeterminate state when some but not
 * all rows are selected.
 */
export function SelectAllCheckbox() {
  const { allIds, selected, toggleAll } = useSelection()
  const total = allIds.length
  const some = selected.size > 0
  const all = total > 0 && selected.size === total && allIds.every((id) => selected.has(id))
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
      checked={all}
      ref={(el) => {
        if (el) el.indeterminate = some && !all
      }}
      onChange={toggleAll}
      aria-label="تحديد الكل"
    />
  )
}

/**
 * Floating action bar — shows only when at least one row is selected. Holds
 * the delete button + count + clear-selection button.
 */
export function SelectionActionBar() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const { selected, clear, entityLabel, onDelete } = useSelection()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (selected.size === 0) return null

  async function doDelete() {
    setErr(null); setDone(null)
    const n = selected.size
    const typed = window.prompt(
      `سيتم حذف ${n} ${n === 1 ? entityLabel.noun : entityLabel.many} المحدَّدة.\n` +
      `اكتب DELETE للتأكيد:`,
    )
    if (typed !== 'DELETE') return
    setBusy(true)
    const res = await onDelete(Array.from(selected))
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setDone(`تم حذف ${res.deleted} ${res.deleted === 1 ? entityLabel.noun : entityLabel.many}.`)
    clear()
    startTransition(() => router.refresh())
  }

  return (
    <div className="sticky top-2 z-30 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border-2 border-teal-300 bg-teal-50 shadow-lg">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-600 hover:bg-white"
          title="إلغاء التحديد"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
        <span className="text-sm font-bold text-teal-900">
          {selected.size} {selected.size === 1 ? entityLabel.noun : entityLabel.many} محدَّدة
        </span>
      </div>
      <div className="flex items-center gap-2">
        {done && <span className="text-xs font-semibold text-emerald-700">{done}</span>}
        {err && <span className="text-xs font-semibold text-red-700">{err}</span>}
        <button
          type="button"
          onClick={doDelete}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold shadow-sm hover:bg-red-700 transition disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          {busy ? 'جارٍ الحذف…' : 'حذف المحدَّد'}
        </button>
      </div>
    </div>
  )
}
