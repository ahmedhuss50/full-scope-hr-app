'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2, Upload, FileText } from 'lucide-react'
import {
  addVendorContract,
  requestVendorContractUploadUrl,
  attachContractPdf,
} from './actions'

const inputCls =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

type FormState = {
  contract_number: string
  work_type: string
  start_date: string
  end_date: string
  total_amount_sar: string // form-level string; parsed on submit
  status: 'active' | 'completed' | 'cancelled'
  notes: string
}

const emptyForm: FormState = {
  contract_number: '',
  work_type: '',
  start_date: '',
  end_date: '',
  total_amount_sar: '',
  status: 'active',
  notes: '',
}

/**
 * Two-step add flow (matches the pattern in ContractPdfUpload):
 *
 *   1. Insert the contract row via addVendorContract (returns contract_id).
 *   2. If the user attached a PDF, request a signed upload URL, PUT the file
 *      to Storage, then call attachContractPdf to write the storage metadata
 *      onto the row. If any step fails we surface the error but the DB row
 *      still exists — the user can retry the PDF attach on a later edit.
 *
 * Rendered inline as an expandable panel from the parent list, not a modal.
 */
export function AddContractDialog({
  vendorId,
  onClose,
  onSaved,
}: {
  vendorId: string
  onClose: () => void
  onSaved?: () => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [state, setState] = useState<FormState>(emptyForm)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  async function submit() {
    setError(null)
    setUploadNote(null)
    setSaving(true)

    const amountRaw = state.total_amount_sar.trim()
    let amount: number | null = null
    if (amountRaw) {
      const n = Number(amountRaw.replace(/,/g, ''))
      if (!Number.isFinite(n) || n < 0) {
        setSaving(false)
        setError('قيمة العقد غير صالحة.')
        return
      }
      amount = n
    }

    const addRes = await addVendorContract({
      vendor_id: vendorId,
      contract_number: state.contract_number || null,
      work_type: state.work_type || null,
      start_date: state.start_date || null,
      end_date: state.end_date || null,
      total_amount_sar: amount,
      status: state.status,
      notes: state.notes || null,
    })
    if (!addRes.ok) {
      setSaving(false)
      setError(addRes.error)
      return
    }

    // If a file was picked, run the two-step upload flow.
    if (file) {
      try {
        const signRes = await requestVendorContractUploadUrl({
          vendor_id: vendorId,
          filename: file.name,
          size: file.size,
        })
        if (!signRes.ok) throw new Error(signRes.error)

        const putResp = await fetch(signRes.signed_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/pdf' },
          body: file,
        })
        if (!putResp.ok) {
          throw new Error(`فشل رفع الملف إلى التخزين (HTTP ${putResp.status}).`)
        }

        const attachRes = await attachContractPdf({
          contract_id: addRes.id,
          storage_path: signRes.storage_path,
          filename: file.name,
          size: file.size,
        })
        if (!attachRes.ok) throw new Error(attachRes.error)
      } catch (err) {
        // The row exists — surface the upload error but don't roll back.
        setSaving(false)
        setUploadNote(
          `تم إنشاء العقد لكن تعذّر رفع الـPDF: ${
            err instanceof Error ? err.message : 'خطأ غير معروف'
          }. يمكنك إعادة المحاولة لاحقًا من تعديل العقد.`,
        )
        startTransition(() => router.refresh())
        return
      }
    }

    setSaving(false)
    setState(emptyForm)
    setFile(null)
    onSaved?.()
    onClose()
    startTransition(() => router.refresh())
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-slate-900">إضافة عقد جديد</div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          title="إغلاق"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white transition"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="رقم العقد">
          <input
            className={inputCls}
            value={state.contract_number}
            onChange={(e) => setState({ ...state, contract_number: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </Field>
        <Field label="نوع العمل">
          <input
            className={inputCls}
            value={state.work_type}
            onChange={(e) => setState({ ...state, work_type: e.target.value })}
            disabled={saving}
          />
        </Field>
        <Field label="تاريخ البدء">
          <input
            className={inputCls}
            type="date"
            value={state.start_date}
            onChange={(e) => setState({ ...state, start_date: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </Field>
        <Field label="تاريخ الانتهاء">
          <input
            className={inputCls}
            type="date"
            value={state.end_date}
            onChange={(e) => setState({ ...state, end_date: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </Field>
        <Field label="القيمة الإجمالية (ر.س)">
          <input
            className={inputCls}
            value={state.total_amount_sar}
            onChange={(e) => setState({ ...state, total_amount_sar: e.target.value })}
            disabled={saving}
            dir="ltr"
            inputMode="decimal"
          />
        </Field>
        <Field label="الحالة">
          <select
            className={inputCls}
            value={state.status}
            onChange={(e) =>
              setState({
                ...state,
                status: e.target.value as FormState['status'],
              })
            }
            disabled={saving}
          >
            <option value="active">سارٍ</option>
            <option value="completed">منتهي</option>
            <option value="cancelled">ملغى</option>
          </select>
        </Field>
        <Field label="ملاحظات" wide>
          <textarea
            className={inputCls + ' min-h-[50px]'}
            value={state.notes}
            onChange={(e) => setState({ ...state, notes: e.target.value })}
            disabled={saving}
            rows={2}
          />
        </Field>
        <Field label="ملف PDF (اختياري)" wide>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer transition">
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              {file ? 'تغيير الملف' : 'اختيار ملف'}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={saving}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f)
                }}
              />
            </label>
            {file && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                <FileText className="w-3 h-3" aria-hidden="true" />
                {file.name}
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={saving}
                  className="inline-flex items-center justify-center w-4 h-4 rounded text-slate-400 hover:text-red-600"
                  title="إزالة الملف"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </span>
            )}
            <span className="text-[10px] text-slate-400">الحد الأقصى 50 ميغابايت</span>
          </div>
        </Field>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}
      {uploadNote && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          {uploadNote}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="w-3 h-3" aria-hidden="true" />
          )}
          {saving ? 'جارٍ الحفظ…' : 'حفظ العقد'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="text-[10px] font-semibold text-slate-500 mb-0.5 block">{label}</label>
      {children}
    </div>
  )
}
