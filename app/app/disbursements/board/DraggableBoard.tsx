'use client'

/**
 * DraggableBoard — kanban with HTML5 drag-and-drop between lanes.
 *
 *   • Any write role (employee / supervisor / owner) can drag any card
 *   • No transition restrictions (per owner spec)
 *   • Confirmation dialog on drop shows source → target
 *   • Optimistic UI: card moves immediately, reverts on server error
 *   • signed_at is auto-stamped by the server when moving into 'signed'
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { dragMoveCase } from '../[caseId]/actions'

type StageKey =
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'signed'
  | 'sent_back_to_developer'

export type BoardCard = {
  id: string
  status: StageKey
  case_number: string
  voucher_number_text: string | null
  amount_sar: number | null
  submitted_at: string | null
  created_at: string
  project_code: string | null
  project_name: string | null
  developer_name: string | null
  beneficiary_name: string | null
}

type Column = { key: StageKey; title: string; headCls: string }
type Props = {
  columns: Column[]
  cards: BoardCard[]
  canDrag: boolean
}

function fmtSar(v: number | null): string {
  if (v == null) return '—'
  try { return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(v) }
  catch { return `${v} ر.س` }
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  try { return new Intl.DateTimeFormat('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(s)) }
  catch { return s }
}

export function DraggableBoard({ columns, cards, canDrag }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  // Optimistic local copy of cards so the UI moves before the server responds.
  const [rows, setRows] = useState<BoardCard[]>(cards)
  const [dragging, setDragging] = useState<string | null>(null)
  const [hoveredLane, setHoveredLane] = useState<StageKey | null>(null)
  const [confirm, setConfirm] = useState<{ card: BoardCard; toStage: StageKey } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const byStatus = new Map<StageKey, BoardCard[]>()
  for (const col of columns) byStatus.set(col.key, [])
  for (const c of rows) {
    const list = byStatus.get(c.status)
    if (list) list.push(c)
  }

  function onCardDragStart(e: React.DragEvent, card: BoardCard) {
    if (!canDrag) { e.preventDefault(); return }
    setDragging(card.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', card.id)
  }

  function onCardDragEnd() {
    setDragging(null)
    setHoveredLane(null)
  }

  function onLaneDragOver(e: React.DragEvent, laneKey: StageKey) {
    if (!canDrag) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (hoveredLane !== laneKey) setHoveredLane(laneKey)
  }

  function onLaneDrop(e: React.DragEvent, laneKey: StageKey) {
    if (!canDrag) return
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    setHoveredLane(null); setDragging(null)
    const card = rows.find((r) => r.id === id)
    if (!card) return
    if (card.status === laneKey) return
    setConfirm({ card, toStage: laneKey })
  }

  async function confirmMove() {
    if (!confirm) return
    const { card, toStage } = confirm
    setBusy(true); setErr(null)
    // Optimistic move.
    const prevStatus = card.status
    setRows((prev) => prev.map((r) => (r.id === card.id ? { ...r, status: toStage } : r)))
    const res = await dragMoveCase({ case_id: card.id, target_status: toStage })
    setBusy(false)
    if (!res.ok) {
      // Revert.
      setRows((prev) => prev.map((r) => (r.id === card.id ? { ...r, status: prevStatus } : r)))
      setErr(res.error)
      return
    }
    setConfirm(null)
    startTransition(() => router.refresh())
  }

  const targetTitle = confirm ? (columns.find((c) => c.key === confirm.toStage)?.title ?? confirm.toStage) : ''
  const sourceTitle = confirm ? (columns.find((c) => c.key === confirm.card.status)?.title ?? confirm.card.status) : ''

  return (
    <>
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {columns.map((col) => {
              const items = byStatus.get(col.key) ?? []
              const isHovered = hoveredLane === col.key
              return (
                <div
                  key={col.key}
                  onDragOver={(e) => onLaneDragOver(e, col.key)}
                  onDrop={(e) => onLaneDrop(e, col.key)}
                  onDragLeave={() => setHoveredLane(null)}
                  className={
                    'flex flex-col border rounded-xl overflow-hidden min-h-[160px] transition ' +
                    (isHovered
                      ? 'bg-teal-50 border-teal-400 ring-2 ring-teal-300'
                      : 'bg-slate-50/60 border-slate-200')
                  }
                >
                  <div className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${col.headCls}`}>
                    <div className="text-xs font-bold truncate">{col.title}</div>
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-white/70 text-[11px] font-bold font-mono">
                      {items.length}
                    </span>
                  </div>
                  <div className="p-2 space-y-2 flex-1">
                    {items.length === 0 ? (
                      <div className="text-center text-xs text-slate-400 py-6">—</div>
                    ) : (
                      items.map((c) => {
                        const isDrag = dragging === c.id
                        return (
                          <div
                            key={c.id}
                            draggable={canDrag}
                            onDragStart={(e) => onCardDragStart(e, c)}
                            onDragEnd={onCardDragEnd}
                            className={
                              'bg-white rounded-lg border border-slate-200 p-2.5 transition ' +
                              (canDrag ? 'cursor-grab active:cursor-grabbing ' : '') +
                              (isDrag ? 'opacity-40' : 'hover:border-teal-300 hover:shadow-sm')
                            }
                          >
                            <Link href={`/app/disbursements/${c.id}`} className="block">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-mono text-[11px] text-slate-500 truncate">{c.case_number}</span>
                              </div>
                              {c.project_name && (
                                <div className="text-[11px] text-slate-500 truncate">
                                  {c.project_code && <span className="font-mono">{c.project_code}</span>}
                                  {c.project_code && <span className="text-slate-400"> · </span>}
                                  <span>{c.project_name}</span>
                                </div>
                              )}
                              {c.developer_name && (
                                <div className="text-[11px] text-slate-400 truncate">{c.developer_name}</div>
                              )}
                              {c.voucher_number_text && (
                                <div className="text-xs text-slate-600 truncate mt-0.5">سند {c.voucher_number_text}</div>
                              )}
                              {c.beneficiary_name && (
                                <div className="text-[11px] text-slate-500 truncate mt-0.5">المستفيد: {c.beneficiary_name}</div>
                              )}
                              <div className="text-sm font-bold text-slate-900 mt-1">{fmtSar(c.amount_sar)}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                {fmtDate(c.submitted_at ?? c.created_at)}
                              </div>
                            </Link>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Confirmation dialog. We keep it as an in-flow overlay (no
          position:fixed inside a widget iframe issues) — the board page
          is a real Next.js route so fixed works. */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" dir="rtl">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 p-5 space-y-3">
            <h3 className="serif font-bold text-lg text-slate-900">تأكيد نقل الطلب</h3>
            <p className="text-sm text-slate-700 leading-relaxed">
              نقل الطلب <span className="font-mono text-slate-900">{confirm.card.case_number}</span> من
              «<span className="font-semibold">{sourceTitle}</span>» إلى «<span className="font-semibold">{targetTitle}</span>»؟
            </p>
            <p className="text-[11px] text-slate-500">
              سيُسجَّل تاريخ النقل في سجل التدقيق تلقائيًا.
              {confirm.toStage === 'signed' && ' سيتم أيضًا تحديث تاريخ التوقيع.'}
            </p>
            {err && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 font-semibold">
                {err}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={confirmMove}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {busy ? 'جارٍ النقل…' : 'تأكيد'}
              </button>
              <button
                type="button"
                onClick={() => { setConfirm(null); setErr(null) }}
                disabled={busy}
                className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
