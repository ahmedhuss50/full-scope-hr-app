'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  Download,
} from 'lucide-react'
import {
  deleteVendorContract,
  signVendorContractPreviewUrl,
  updateVendorContract,
} from './actions'
import { AddContractDialog } from './AddContractDialog'
import type { VendorContractRow } from './page'

const inputCls =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

function fmtSar(v: number | null): string {
  if (v == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ر.س`
  }
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(s + 'T00:00:00'))
  } catch {
    return s
  }
}
function statusPill(s: string): { cls: string; label: string } {
  switch (s) {
    case 'active':
      return { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'سارٍ' }
    case 'completed':
      return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'منتهي' }
    case 'cancelled':
      return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'ملغى' }
    default:
      return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: s }
  }
}

export function VendorContractsList({
  vendorId,
  vendorName,
  initialContracts,
  canEdit,
  canDelete,
}: {
  vendorId: string
  vendorName: string
  initialContracts: VendorContractRow[]
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const hasContracts = initialContracts.length > 0

  // Auto-open when the user clicks "add contract" while the section is collapsed.
  function beginAdd() {
    setOpen(true)
    setAddingNew(true)
  }

  async function onDownload(contractId: string) {
    const res = await signVendorContractPreviewUrl({ contract_id: contractId })
    if (!res.ok) {
      alert(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  async function onDelete(contractId: string, label: string) {
    if (!confirm(`حذف العقد «${label}»؟ لا يمكن التراجع.`)) return
    const res = await deleteVendorContract({ id: contractId })
    if (!res.ok) {
      alert(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <div className="min-w-[240px] flex-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          {open ? (
            <ChevronUp className="w-3 h-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
          )}
          {open ? 'إخفاء العقود' : 'عرض العقود'}
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={beginAdd}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 text-[11px] font-semibold transition"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            إضافة عقد
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {addingNew && (
            <AddContractDialog
              vendorId={vendorId}
              onClose={() => setAddingNew(false)}
            />
          )}

          {!hasContracts && !addingNew && (
            <div className="text-[11px] text-slate-500 italic border border-dashed border-slate-200 rounded-md px-2 py-3 text-center">
              لا توجد عقود مسجّلة لهذا المورد ({vendorName}).
            </div>
          )}

          {hasContracts && (
            <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-right">
                    <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">رقم العقد</th>
                    <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">نوع العمل</th>
                    <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">التاريخ</th>
                    <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">القيمة</th>
                    <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">الحالة</th>
                    <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {initialContracts.map((c) => {
                    const pill = statusPill(c.status)
                    if (editingId === c.id) {
                      return (
                        <tr key={c.id} className="bg-teal-50/30">
                          <td colSpan={6} className="p-2">
                            <EditContractInline
                              contract={c}
                              onClose={() => setEditingId(null)}
                              onSaved={() => setEditingId(null)}
                            />
                          </td>
                        </tr>
                      )
                    }
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70">
                        <td className="px-2 py-1.5">
                          <span className="font-mono text-[11px]" dir="ltr">
                            {c.contract_number ?? '—'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-slate-700">{c.work_type ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <div className="text-[11px] text-slate-700 leading-tight">
                            <div>{fmtDate(c.start_date)}</div>
                            {c.end_date && (
                              <div className="text-slate-500">حتى {fmtDate(c.end_date)}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 font-mono">{fmtSar(c.total_amount_sar)}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset ${pill.cls}`}
                          >
                            {pill.label}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            {c.storage_path ? (
                              <button
                                type="button"
                                onClick={() => onDownload(c.id)}
                                title={c.filename ?? 'تحميل الملف'}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 hover:bg-teal-50 transition"
                              >
                                <Download className="w-3 h-3" aria-hidden="true" />
                                تحميل
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400">—</span>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => setEditingId(c.id)}
                                title="تعديل"
                                className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-teal-700 hover:bg-teal-50 transition"
                              >
                                <Pencil className="w-3 h-3" aria-hidden="true" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() =>
                                  onDelete(
                                    c.id,
                                    c.contract_number ??
                                      c.work_type ??
                                      'بدون رقم',
                                  )
                                }
                                title="حذف العقد"
                                className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                              >
                                <Trash2 className="w-3 h-3" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EditContractInline — inline edit form for an existing contract row.
// Kept in this file to keep the vendor row contained.
// ---------------------------------------------------------------------------

function EditContractInline({
  contract,
  onClose,
  onSaved,
}: {
  contract: VendorContractRow
  onClose: () => void
  onSaved?: () => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [state, setState] = useState({
    contract_number: contract.contract_number ?? '',
    work_type: contract.work_type ?? '',
    start_date: contract.start_date ?? '',
    end_date: contract.end_date ?? '',
    total_amount_sar:
      contract.total_amount_sar != null ? String(contract.total_amount_sar) : '',
    status: (contract.status as 'active' | 'completed' | 'cancelled') || 'active',
    notes: contract.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    setSaving(true)
    let amount: number | null = null
    const raw = state.total_amount_sar.trim()
    if (raw) {
      const n = Number(raw.replace(/,/g, ''))
      if (!Number.isFinite(n) || n < 0) {
        setSaving(false)
        setError('قيمة العقد غير صالحة.')
        return
      }
      amount = n
    }
    const res = await updateVendorContract({
      id: contract.id,
      patch: {
        contract_number: state.contract_number || null,
        work_type: state.work_type || null,
        start_date: state.start_date || null,
        end_date: state.end_date || null,
        total_amount_sar: amount,
        status: state.status,
        notes: state.notes || null,
      },
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onSaved?.()
    onClose()
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <SmallField label="رقم العقد">
          <input
            className={inputCls}
            value={state.contract_number}
            onChange={(e) => setState({ ...state, contract_number: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </SmallField>
        <SmallField label="نوع العمل">
          <input
            className={inputCls}
            value={state.work_type}
            onChange={(e) => setState({ ...state, work_type: e.target.value })}
            disabled={saving}
          />
        </SmallField>
        <SmallField label="القيمة (ر.س)">
          <input
            className={inputCls}
            value={state.total_amount_sar}
            onChange={(e) => setState({ ...state, total_amount_sar: e.target.value })}
            disabled={saving}
            dir="ltr"
            inputMode="decimal"
          />
        </SmallField>
        <SmallField label="تاريخ البدء">
          <input
            className={inputCls}
            type="date"
            value={state.start_date}
            onChange={(e) => setState({ ...state, start_date: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </SmallField>
        <SmallField label="تاريخ الانتهاء">
          <input
            className={inputCls}
            type="date"
            value={state.end_date}
            onChange={(e) => setState({ ...state, end_date: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </SmallField>
        <SmallField label="الحالة">
          <select
            className={inputCls}
            value={state.status}
            onChange={(e) =>
              setState({
                ...state,
                status: e.target.value as 'active' | 'completed' | 'cancelled',
              })
            }
            disabled={saving}
          >
            <option value="active">سارٍ</option>
            <option value="completed">منتهي</option>
            <option value="cancelled">ملغى</option>
          </select>
        </SmallField>
        <SmallField label="ملاحظات" wide>
          <textarea
            className={inputCls + ' min-h-[40px]'}
            value={state.notes}
            onChange={(e) => setState({ ...state, notes: e.target.value })}
            disabled={saving}
            rows={2}
          />
        </SmallField>
      </div>
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-600 text-white text-[10px] font-semibold hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="w-3 h-3" aria-hidden="true" />
          )}
          حفظ
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 bg-white text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <X className="w-3 h-3" aria-hidden="true" />
          إلغاء
        </button>
      </div>
    </div>
  )
}

function SmallField({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <label className="text-[10px] font-semibold text-slate-500 mb-0.5 block">{label}</label>
      {children}
    </div>
  )
}
