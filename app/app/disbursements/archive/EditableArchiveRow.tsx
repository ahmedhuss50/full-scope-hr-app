'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Pencil, Check, X, PackageCheck, ExternalLink } from 'lucide-react'
import { fmtDateTime } from '@/lib/dsb/datetime'
import { updateDeliveryInfo } from './actions'

/**
 * A single editable row in the archive table.
 *
 * Display mode: shows recipient name + phone, delivery time, action buttons.
 * Edit mode: name becomes a text input, delivered_at becomes a datetime-local
 * input. Save commits via updateDeliveryInfo; Cancel restores the originals.
 *
 * `canEdit` is decided on the server (passed down from the page). Viewer
 * never sees the pencil; deliverer + write roles do.
 */
type PaidFromOption = { id: string; label: string }

export function EditableArchiveRow({
  caseId,
  caseNumber,
  project,
  developer,
  voucherNumber,
  amountLabel,
  recipientName,
  recipientPhone,
  deliveredAt,
  delivererName,
  canEdit,
  paidFromAccountId,
  paidFromLabel,
  accountOptions,
  paidAt,
}: {
  caseId: string
  caseNumber: string
  project: { code: string; name_ar: string } | null
  developer: { company_name_ar: string } | null
  voucherNumber: string | null
  amountLabel: string
  recipientName: string | null
  recipientPhone: string | null
  deliveredAt: string | null
  delivererName: string
  canEdit: boolean
  // The account currently linked to this case (null if cleared OR if the
  // account was deleted — the FK is ON DELETE SET NULL).
  paidFromAccountId: string | null
  paidFromLabel: string | null
  // The full list of accounts available for this case's project. Empty
  // array if the project hasn't had any accounts configured yet.
  accountOptions: PaidFromOption[]
  // Date the disbursement was actually paid (YYYY-MM-DD).
  paidAt: string | null
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local edit state. Reset on every entry into edit mode so a Cancel-then-
  // Edit doesn't carry over the previous (possibly half-typed) values.
  const [nameDraft, setNameDraft] = useState<string>(recipientName ?? '')
  const [dateDraft, setDateDraft] = useState<string>(toLocalDateTimeInput(deliveredAt))
  const [paidFromDraft, setPaidFromDraft] = useState<string>(paidFromAccountId ?? '')
  const [paidAtDraft, setPaidAtDraft] = useState<string>(paidAt ?? '')

  function startEdit() {
    setError(null)
    setNameDraft(recipientName ?? '')
    setDateDraft(toLocalDateTimeInput(deliveredAt))
    setPaidFromDraft(paidFromAccountId ?? '')
    setPaidAtDraft(paidAt ?? '')
    setEditing(true)
  }

  function cancelEdit() {
    setError(null)
    setEditing(false)
  }

  async function save() {
    setError(null)
    setSaving(true)
    // datetime-local gives us "YYYY-MM-DDTHH:mm" in the user's local time
    // (no timezone). new Date() interprets it as local — converting to ISO
    // gives the correct UTC timestamp. The server normalises again.
    const isoDelivered = dateDraft ? new Date(dateDraft).toISOString() : null
    const res = await updateDeliveryInfo({
      case_id: caseId,
      recipient_name: nameDraft,
      delivered_at: isoDelivered,
      paid_from_account_id: paidFromDraft || null,
      paid_at: paidAtDraft || null,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditing(false)
    startTransition(() => router.refresh())
  }

  return (
    <tr className="hover:bg-slate-50 transition">
      <Td>
        <Link
          href={`/app/disbursements/${caseId}`}
          className="font-mono text-xs font-semibold text-teal-700 hover:text-teal-900"
        >
          {caseNumber}
        </Link>
      </Td>
      <Td>
        {project ? (
          <span>
            <span className="font-mono text-xs text-slate-500">{project.code}</span>
            <span className="text-slate-400 mx-1">·</span>
            <span className="text-slate-900">{project.name_ar}</span>
          </span>
        ) : (
          '—'
        )}
      </Td>
      <Td>{developer?.company_name_ar ?? '—'}</Td>
      <Td>
        <span className="font-mono text-xs">{voucherNumber ?? '—'}</span>
      </Td>
      <Td>
        <span className="font-mono">{amountLabel}</span>
      </Td>

      {/* Paid-from account cell — editable */}
      <Td>
        {editing ? (
          accountOptions.length === 0 ? (
            <span className="text-[11px] text-slate-500 italic">
              لا توجد حسابات لهذا المشروع.
            </span>
          ) : (
            <select
              value={paidFromDraft}
              onChange={(e) => setPaidFromDraft(e.target.value)}
              disabled={saving}
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
            >
              <option value="">— غير محدد —</option>
              {accountOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          )
        ) : (
          <span className="text-slate-900">{paidFromLabel ?? '—'}</span>
        )}
      </Td>

      {/* Payment date cell — editable */}
      <Td>
        {editing ? (
          <input
            type="date"
            value={paidAtDraft}
            onChange={(e) => setPaidAtDraft(e.target.value)}
            disabled={saving}
            dir="ltr"
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
          />
        ) : (
          <span className="text-slate-900">{paidAt ? fmtPaidDate(paidAt) : '—'}</span>
        )}
      </Td>

      {/* Recipient cell — editable */}
      <Td>
        {editing ? (
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            disabled={saving}
            placeholder="اسم المستلم"
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
          />
        ) : (
          <div className="leading-tight">
            <div className="text-slate-900">{recipientName ?? '—'}</div>
            {recipientPhone && (
              <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                {recipientPhone}
              </div>
            )}
          </div>
        )}
      </Td>

      {/* Delivery time cell — editable */}
      <Td>
        {editing ? (
          <input
            type="datetime-local"
            value={dateDraft}
            onChange={(e) => setDateDraft(e.target.value)}
            disabled={saving}
            dir="ltr"
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
          />
        ) : (
          <span className="inline-flex items-center gap-1 text-slate-700">
            <PackageCheck className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
            {fmtDateTime(deliveredAt)}
          </span>
        )}
      </Td>

      <Td>{delivererName}</Td>

      {/* Action cell — open OR edit / save / cancel */}
      <Td>
        {editing ? (
          <div className="inline-flex flex-col items-stretch gap-1">
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                {saving ? '...' : 'حفظ'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                إلغاء
              </button>
            </div>
            {error && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="inline-flex items-center gap-1">
            <Link
              href={`/app/disbursements/${caseId}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              فتح
            </Link>
            {canEdit && (
              <button
                type="button"
                onClick={startEdit}
                title="تعديل بيانات التسليم"
                className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-teal-700 hover:bg-slate-50 transition"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </Td>
    </tr>
  )
}

/**
 * Format an ISO timestamp into the `YYYY-MM-DDTHH:mm` shape datetime-local
 * inputs expect, in the user's LOCAL timezone (matching what the browser
 * would store back).
 */
/**
 * Render a YYYY-MM-DD date string as Arabic locale date (e.g. "٢٥ يونيو ٢٠٢٦").
 * Falls back to the raw string if anything is weird.
 */
function fmtPaidDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(s + 'T00:00:00'))
  } catch {
    return s
  }
}

function toLocalDateTimeInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-sm text-slate-700 align-top">{children}</td>
}
