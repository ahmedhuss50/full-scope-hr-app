/**
 * SectionCard — the reusable wrapper used for every تهيئة المشروع section.
 *
 * Three visible states:
 *   1. "empty"     → nothing configured yet. Shows a friendly prompt.
 *   2. "summary"   → configured. Shows a compact read-only summary.
 *   3. "editing"   → the section's own edit UI is being rendered inline
 *                    (the parent controls this by rendering its edit component
 *                    as `children`).
 *
 * Sections are visually numbered so the whole screen reads like a checklist,
 * and each card carries a completion tick when populated.
 *
 * Setup screen sections that need "open the existing page" instead of inline
 * editing (in slice 1: everything except Basics) pass a `href` and the card
 * shows a link button in place of an inline «تعديل» button.
 */
import React from 'react'
import Link from 'next/link'
import { Check, Circle, ChevronLeft, Pencil } from 'lucide-react'

export function SectionCard({
  index,
  title,
  complete,
  summary,
  emptyPrompt,
  href,
  editSlot,
  children,
}: {
  index: number
  title: string
  /** true → tick + green ring. false → hollow circle + amber ring. */
  complete: boolean
  /** Compact prose shown when the section is populated. React node so callers
   *  can drop chips / small tables in without repeating layout code. */
  summary?: React.ReactNode
  /** Text shown when the section is empty. Overridden by callers that want
   *  a specific empty-state CTA (rare). */
  emptyPrompt?: React.ReactNode
  /** External page to open for edit. When set, we render a link instead of
   *  the inline edit toggle. Slice 1 uses this for every section except
   *  Basics; later slices will remove `href` and pass an inline `editSlot`
   *  as sections graduate to inline editing. */
  href?: string
  /** Inline edit control (usually a button that expands the client-side
   *  editor rendered as `children`). */
  editSlot?: React.ReactNode
  /** Inline editor UI (typically rendered conditionally by the caller). */
  children?: React.ReactNode
}) {
  const ringCls = complete
    ? 'border-emerald-200 bg-white'
    : 'border-amber-200 bg-amber-50/30'
  const iconCls = complete ? 'text-emerald-600' : 'text-amber-500'

  return (
    <section className={`rounded-xl border shadow-sm ${ringCls}`}>
      <header className="flex items-start gap-3 px-5 pt-4 pb-3">
        <div className="mt-0.5 shrink-0">
          {complete ? (
            <Check className={`w-5 h-5 ${iconCls}`} aria-hidden="true" />
          ) : (
            <Circle className={`w-5 h-5 ${iconCls}`} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="serif font-bold text-base text-slate-900">
              <span className="text-slate-400 font-mono ms-1 text-xs align-middle">{index}.</span>{' '}
              {title}
            </h3>
            {/* Right-side actions: either an inline edit slot or a link
                out to the section's dedicated page (slice-1 fallback). */}
            {editSlot
              ? editSlot
              : href
              ? (
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  تعديل
                  <ChevronLeft className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
                </Link>
              )
              : null}
          </div>
        </div>
      </header>

      <div className="px-5 pb-5">
        {/* Show the summary when populated. When empty AND not currently
            being edited, show the empty-state prompt to nudge the user. */}
        {complete && summary ? (
          <div className="text-sm text-slate-700">{summary}</div>
        ) : null}
        {!complete && !children ? (
          <div className="text-sm text-slate-500 italic">
            {emptyPrompt ?? 'لم يُهيّأ بعد.'}
          </div>
        ) : null}
        {children /* the section's inline editor, when the caller opens it */}
      </div>
    </section>
  )
}
