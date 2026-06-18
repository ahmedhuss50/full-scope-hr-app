'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import { addCaseComment, deleteCaseComment } from './actions'
import { fmtDateTime } from '@/lib/dsb/datetime'

type Role = 'employee' | 'supervisor' | 'owner' | null

const ROLE_LABEL: Record<Exclude<Role, null>, string> = {
  employee:   'مراجع',
  supervisor: 'مشرف',
  owner:      'مدير',
}

const ROLE_PILL: Record<Exclude<Role, null>, string> = {
  employee:   'bg-teal-50 text-teal-700 ring-teal-200',
  supervisor: 'bg-amber-50 text-amber-800 ring-amber-200',
  owner:      'bg-violet-50 text-violet-700 ring-violet-200',
}

export type CommentRow = {
  id: string
  body: string
  created_at: string
  author: {
    id: string
    full_name: string | null
    email: string | null
    dsb_role: Role
  }
}

/**
 * Per-case thread. Staff can post comments and see what other reviewers said.
 * Each comment shows author name + role pill + timestamp. Author of a comment
 * (or any owner) can delete it; deletes are soft (audit-safe).
 */
export function CommentsThread({
  caseId,
  currentUserId,
  currentUserRole,
  comments,
}: {
  caseId: string
  currentUserId: string
  currentUserRole: Role
  comments: CommentRow[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canPost =
    currentUserRole === 'employee' || currentUserRole === 'supervisor' || currentUserRole === 'owner'

  async function onPost() {
    setError(null)
    const trimmed = body.trim()
    if (!trimmed) return
    setPosting(true)
    const res = await addCaseComment({ case_id: caseId, body: trimmed })
    setPosting(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setBody('')
    startTransition(() => router.refresh())
  }

  async function onDelete(commentId: string) {
    if (!confirm('حذف هذا التعليق؟')) return
    const res = await deleteCaseComment({ comment_id: commentId })
    if (!res.ok) {
      alert(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="serif font-bold text-lg text-slate-900 inline-flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-slate-500" aria-hidden="true" />
          نقاش الطلب
          {comments.length > 0 && (
            <span className="text-xs font-mono text-slate-400">({comments.length})</span>
          )}
        </h2>
      </div>

      {comments.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-4 border border-dashed border-slate-200 rounded-md">
          لا توجد تعليقات بعد — كن أوّل من يضيف ملاحظة على هذا الطلب.
        </div>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const canDelete =
              c.author.id === currentUserId || currentUserRole === 'owner'
            const rolePill = c.author.dsb_role ? ROLE_PILL[c.author.dsb_role] : 'bg-slate-100 text-slate-600 ring-slate-200'
            const roleLabel = c.author.dsb_role ? ROLE_LABEL[c.author.dsb_role] : '—'
            return (
              <li key={c.id} className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {c.author.full_name ?? c.author.email ?? '—'}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${rolePill}`}>
                      {roleLabel}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {fmtDateTime(c.created_at)}
                    </span>
                  </div>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(c.id)}
                      title="حذف التعليق"
                      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed break-words">
                  {c.body}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canPost && (
        <div className="pt-3 border-t border-slate-100 space-y-2">
          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={posting}
            placeholder="اكتب تعليقًا أو ملاحظة للزملاء…"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onPost()
              }
            }}
          />
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-slate-400">⌘+Enter لإرسال سريع</span>
            <button
              type="button"
              onClick={onPost}
              disabled={posting || !body.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              {posting ? 'جارٍ الإرسال…' : 'إرسال التعليق'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
