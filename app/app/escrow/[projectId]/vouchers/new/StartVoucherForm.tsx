'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, X } from 'lucide-react'
import { strings, type Locale } from '@/lib/i18n/translations'
import {
  createVoucher,
  requestVoucherUploadUrls,
  registerVoucherUploads,
  kickoffVoucherAudit,
} from './actions'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB

const ACCEPT =
  'application/pdf,image/jpeg,image/jpg,image/png'

export type SupplierOption = {
  id: string
  name_en: string
  name_ar: string | null
}

export type AccountOption = {
  id: string
  account_type: 'construction' | 'non_construction' | 'preservation'
  bank_name: string | null
  iban: string | null
}

export type SignerOption = {
  id: string
  name: string
  title: string | null
}

type ExpenseNature = 'construction' | 'non_construction' | 'preservation'

const EXPENSE_OPTIONS: ExpenseNature[] = ['construction', 'non_construction', 'preservation']

export function StartVoucherForm({
  locale,
  projectId,
  suppliers,
  accounts,
  signers,
}: {
  locale: Locale
  projectId: string
  suppliers: SupplierOption[]
  accounts: AccountOption[]
  signers: SignerOption[]
}) {
  const router = useRouter()
  const t = (key: keyof typeof strings, vars?: Record<string, string | number>): string => {
    const raw: string = strings[key]?.[locale] ?? strings[key]?.en ?? String(key)
    if (!vars) return raw
    return Object.entries(vars).reduce<string>(
      (acc, [k, val]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(val)),
      raw,
    )
  }

  // Today as ISO date (yyyy-mm-dd) — used as the default voucher_date.
  const today = new Date().toISOString().slice(0, 10)

  const [voucherNumber, setVoucherNumber] = useState('')
  const [voucherDate, setVoucherDate] = useState(today)
  const [totalSar, setTotalSar] = useState<string>('')
  const [expenseNature, setExpenseNature] = useState<ExpenseNature>('construction')
  const [supplierId, setSupplierId] = useState<string>(suppliers[0]?.id ?? '')
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '')
  const [signerId, setSignerId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ n: number; m: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const picked = Array.from(e.target.files ?? [])
    const safe: File[] = []
    for (const f of picked) {
      if (f.size > MAX_FILE_SIZE) {
        setError(`${t('escrow.voucher.error.upload_failed')} (${f.name})`)
        continue
      }
      safe.push(f)
    }
    setFiles((prev) => [...prev, ...safe])
    // Reset the native input so picking the same file twice still fires onChange.
    e.target.value = ''
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  function accountLabel(a: AccountOption): string {
    const typeLabel = t(`escrow.voucher.expense.${a.account_type}` as keyof typeof strings)
    const parts = [typeLabel]
    if (a.bank_name) parts.push(a.bank_name)
    if (a.iban) parts.push(a.iban.slice(-8))
    return parts.join(' · ')
  }

  function supplierLabel(s: SupplierOption): string {
    return locale === 'ar' ? (s.name_ar ?? s.name_en) : s.name_en
  }

  function signerLabel(s: SignerOption): string {
    if (s.title) return `${s.name} — ${s.title}`
    return s.name
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const totalNum = Number(totalSar)
    if (
      !voucherNumber.trim() ||
      !voucherDate ||
      !Number.isFinite(totalNum) ||
      totalNum <= 0 ||
      !supplierId ||
      !accountId ||
      files.length === 0
    ) {
      setError(t('escrow.voucher.error.required'))
      return
    }

    setSubmitting(true)
    try {
      // 1) Create the voucher row.
      const create = await createVoucher({
        project_id: projectId,
        voucher_number: voucherNumber.trim(),
        voucher_date: voucherDate,
        total_sar: totalNum,
        expense_nature: expenseNature,
        beneficiary_supplier_id: supplierId,
        source_escrow_account_id: accountId,
        signed_by_authorized_signer_id: signerId || null,
        notes: notes.trim() || null,
      })
      if (!create.ok) {
        setError(create.error || t('escrow.voucher.error.create_failed'))
        setSubmitting(false)
        return
      }
      const voucherId = create.voucher_id

      // 2) Mint signed upload URLs.
      const urls = await requestVoucherUploadUrls({
        voucher_id: voucherId,
        files: files.map((f) => ({
          filename: f.name,
          mime: f.type || 'application/octet-stream',
          size: f.size,
        })),
      })
      if (!urls.ok) {
        setError(urls.error || t('escrow.voucher.error.upload_failed'))
        setSubmitting(false)
        return
      }

      // 3) PUT each file directly to Storage.
      const total = urls.slots.length
      for (let i = 0; i < total; i++) {
        const slot = urls.slots[i]
        const file = files[i]
        if (!slot || !file) continue
        setProgress({ n: i + 1, m: total })
        const putRes = await fetch(slot.signed_url, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'x-upsert': 'true',
          },
        })
        if (!putRes.ok) {
          setError(`${t('escrow.voucher.error.upload_failed')} (${file.name}: HTTP ${putRes.status})`)
          setSubmitting(false)
          return
        }
      }

      // 4) Register the upload metadata.
      const reg = await registerVoucherUploads({
        voucher_id: voucherId,
        uploads: urls.slots.map((slot, i) => {
          const f = files[i]
          return {
            slot_id: slot.slot_id,
            storage_path: slot.storage_path,
            declared_kind: 'unknown',
            filename: f.name,
            size: f.size,
            mime: f.type || 'application/octet-stream',
          }
        }),
      })
      if (!reg.ok) {
        setError(reg.error || t('escrow.voucher.error.register_failed'))
        setSubmitting(false)
        return
      }

      // 5) Fire the n8n webhook — best-effort, never blocks the redirect.
      try {
        await kickoffVoucherAudit({ voucher_id: voucherId })
      } catch (err) {
        console.error('[StartVoucherForm] kickoff threw', err)
      }

      router.push(`/app/escrow/${projectId}/vouchers/${voucherId}?just_uploaded=1`)
    } catch (err) {
      console.error('[StartVoucherForm] submit threw', err)
      setError(err instanceof Error ? err.message : t('escrow.voucher.error.create_failed'))
      setSubmitting(false)
    }
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  let submitLabel = t('escrow.voucher.submit')
  if (submitting) {
    submitLabel = progress
      ? t('escrow.voucher.uploading_n_of_m', { n: progress.n, m: progress.m })
      : t('escrow.voucher.submitting')
  }

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

      {/* Voucher number + date */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="voucher_number">
            {t('escrow.voucher.field.voucher_number')} *
          </label>
          <input
            id="voucher_number"
            name="voucher_number"
            required
            maxLength={60}
            className={inputCls}
            placeholder="VCH-MP2-001"
            value={voucherNumber}
            onChange={(e) => setVoucherNumber(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="voucher_date">
            {t('escrow.voucher.field.voucher_date')} *
          </label>
          <input
            id="voucher_date"
            name="voucher_date"
            type="date"
            required
            className={inputCls}
            value={voucherDate}
            onChange={(e) => setVoucherDate(e.target.value)}
          />
        </div>
      </div>

      {/* Total + expense nature */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="total_sar">
            {t('escrow.voucher.field.total_sar')} *
          </label>
          <input
            id="total_sar"
            name="total_sar"
            type="number"
            required
            min={0}
            step="0.01"
            className={inputCls}
            placeholder="0.00"
            value={totalSar}
            onChange={(e) => setTotalSar(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="expense_nature">
            {t('escrow.voucher.field.expense_nature')} *
          </label>
          <select
            id="expense_nature"
            name="expense_nature"
            required
            className={inputCls}
            value={expenseNature}
            onChange={(e) => setExpenseNature(e.target.value as ExpenseNature)}
          >
            {EXPENSE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`escrow.voucher.expense.${opt}` as keyof typeof strings)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Beneficiary + Source account */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="supplier_id">
            {t('escrow.voucher.field.beneficiary')} *
          </label>
          <select
            id="supplier_id"
            name="supplier_id"
            required
            className={inputCls}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {supplierLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="account_id">
            {t('escrow.voucher.field.source_account')} *
          </label>
          <select
            id="account_id"
            name="account_id"
            required
            className={inputCls}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Signer (optional) */}
      <div>
        <label className={labelCls} htmlFor="signer_id">
          {t('escrow.voucher.field.signer')}
        </label>
        <select
          id="signer_id"
          name="signer_id"
          className={inputCls}
          value={signerId}
          onChange={(e) => setSignerId(e.target.value)}
        >
          <option value="">—</option>
          {signers.map((s) => (
            <option key={s.id} value={s.id}>
              {signerLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls} htmlFor="notes">
          {t('escrow.voucher.field.notes')}
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Files */}
      <div>
        <label className={labelCls} htmlFor="files">
          {t('escrow.voucher.field.files')} *
        </label>
        <p className="text-xs text-slate-500 mb-2 leading-relaxed">
          {t('escrow.voucher.field.files_hint')}
        </p>

        <label
          htmlFor="files"
          className="flex items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:border-teal-400 hover:bg-teal-50/40 transition"
        >
          <Upload className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-700">
            {locale === 'ar' ? 'اضغط لاختيار الملفات' : 'Click to choose files'}
          </span>
        </label>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          accept={ACCEPT}
          onChange={onPickFiles}
          className="hidden"
        />

        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white"
              >
                <FileText className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{f.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {(f.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  disabled={submitting}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
                  aria-label="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <a
          href={`/app/escrow/${projectId}`}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          {t('escrow.voucher.cancel')}
        </a>
      </div>
    </form>
  )
}
