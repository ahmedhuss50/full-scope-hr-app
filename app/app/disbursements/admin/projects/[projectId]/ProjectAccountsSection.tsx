'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Upload, Check, X, Wallet } from 'lucide-react'
import {
  addProjectAccount,
  deleteProjectAccount,
  bulkUploadProjectAccounts,
} from '../../edit-actions'

// Migration 063 — one of the four escrow-mandated slots this account
// occupies (or null for ordinary accounts). Only 'general' accounts trigger
// the buyer-deposit auto-distribution.
export type AccountRole = 'general' | 'construction' | 'admin_marketing' | 'escrow'

const ACCOUNT_ROLE_OPTIONS: Array<{ value: '' | AccountRole; label: string }> = [
  { value: '',                'label': '— (بدون دور)' },
  { value: 'general',         'label': 'الحساب العام' },
  { value: 'construction',    'label': 'الانشاءات' },
  { value: 'admin_marketing', 'label': 'الاداري والتسويقي' },
  { value: 'escrow',          'label': 'الحفظ' },
]

const ROLE_LABEL: Record<AccountRole, string> = {
  general:         'الحساب العام',
  construction:    'الانشاءات',
  admin_marketing: 'الاداري والتسويقي',
  escrow:          'الحفظ',
}

export type ProjectAccount = {
  id: string
  label: string
  account_number: string | null
  bank_name: string | null
  iban: string | null
  account_role: AccountRole | null
}

type ParsedRow = {
  label: string
  account_number: string | null
  bank_name: string | null
  iban: string | null
}

/**
 * Per-project payment accounts admin UI. Owner-only — the parent page
 * decides whether to render this component based on dsb_role.
 *
 * Two ways to add accounts:
 *   1. Inline form (one at a time).
 *   2. Excel upload (.xlsx / .xls) — header row ignored, then columns:
 *      A=label, B=account#, C=bank, D=IBAN. Parsed client-side using a
 *      dynamic import of SheetJS so the bundle isn't bloated for the
 *      common case where the upload isn't used.
 *
 * Deletion uses ON DELETE SET NULL on dsb_cases.paid_from_account_id —
 * historical delivery records keep their data, they just lose the
 * back-reference.
 */
export function ProjectAccountsSection({
  projectId,
  initialAccounts,
}: {
  projectId: string
  initialAccounts: ProjectAccount[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [label, setLabel] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [bankName, setBankName] = useState('')
  const [iban, setIban] = useState('')
  const [accountRole, setAccountRole] = useState<'' | AccountRole>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  function resetAddForm() {
    setLabel('')
    setAccountNumber('')
    setBankName('')
    setIban('')
    setAccountRole('')
    setError(null)
  }

  async function onAdd() {
    setError(null)
    setSaving(true)
    const res = await addProjectAccount({
      project_id: projectId,
      label,
      account_number: accountNumber || null,
      bank_name: bankName || null,
      iban: iban || null,
      account_role: accountRole || null,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    resetAddForm()
    setShowAddForm(false)
    startTransition(() => router.refresh())
  }

  async function onDelete(id: string, accountLabel: string) {
    if (!confirm(`حذف الحساب "${accountLabel}"؟ ستفقد الطلبات السابقة الإشارة إليه (تبقى بياناتها كما هي).`)) {
      return
    }
    const res = await deleteProjectAccount({ id })
    if (!res.ok) {
      alert(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    setBulkError(null)
    setParsed(null)
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true)
    try {
      // Dynamic import — this admin tool is rarely used, no need to ship
      // SheetJS in every page bundle.
      //
      // We deliberately use a non-literal specifier and `any` typing so the
      // build doesn't fail in environments where xlsx isn't yet installed
      // (the dep is in package.json; Vercel resolves it on deploy). Runtime
      // shape is what matters here.
      const moduleName = 'xlsx'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX: any = await import(/* webpackIgnore: false */ moduleName)
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) {
        setBulkError('الملف فارغ.')
        return
      }
      // header: 1 returns arrays of cell values, row-by-row. raw:false
      // gives string-coerced values which is what we want for IBANs etc.
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
      })
      // Skip header row.
      const dataRows = rows.slice(1)
      const out: ParsedRow[] = []
      for (const r of dataRows) {
        const cells = r as unknown[]
        const cellAt = (i: number): string => {
          const v = cells[i]
          if (v === null || v === undefined) return ''
          return String(v).trim()
        }
        const lbl = cellAt(0)
        if (!lbl) continue // skip blank-label rows
        out.push({
          label: lbl,
          account_number: cellAt(1) || null,
          bank_name: cellAt(2) || null,
          iban: cellAt(3).toUpperCase() || null,
        })
      }
      if (out.length === 0) {
        setBulkError('لم يتم العثور على أي صف صالح (اسم الحساب مطلوب في العمود الأول).')
        return
      }
      setParsed(out)
    } catch (err) {
      setBulkError(`تعذّر قراءة الملف: ${(err as Error).message}`)
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function confirmBulkUpload() {
    if (!parsed || parsed.length === 0) return
    setBulkError(null)
    setBulkSaving(true)
    const res = await bulkUploadProjectAccounts({
      project_id: projectId,
      accounts: parsed,
    })
    setBulkSaving(false)
    if (!res.ok) {
      setBulkError(res.error)
      return
    }
    setParsed(null)
    startTransition(() => router.refresh())
  }

  function cancelBulk() {
    setParsed(null)
    setBulkError(null)
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <h2 className="serif font-bold text-lg text-slate-900">حسابات الدفع للمشروع</h2>
          <span className="text-xs text-slate-500 font-mono">({initialAccounts.length})</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            إضافة حساب
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={parsing || bulkSaving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            رفع قائمة من Excel
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={onFilePicked}
          />
        </div>
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        قائمة الحسابات البنكية التي تخرج منها مبالغ الصرف لهذا المشروع. عند
        تسليم سند سيختار المسؤول الحساب الذي تم الصرف منه.
        <br />
        صيغة ملف Excel: الصف الأول عنوان (يُتجاهَل) — العمود A: اسم الحساب
        (مطلوب) · العمود B: رقم الحساب · العمود C: البنك · العمود D: IBAN.
      </p>

      {/* Inline add form */}
      {showAddForm && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/30 p-4 space-y-3">
          <h3 className="serif font-bold text-sm text-slate-900">إضافة حساب جديد</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم الحساب *</label>
              <input
                className={inputCls}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={saving}
                placeholder="مثلاً: الحساب الرئيسي"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">البنك</label>
              <input
                className={inputCls}
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                disabled={saving}
                placeholder="مثلاً: بنك البلاد"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم الحساب</label>
              <input
                className={inputCls}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                disabled={saving}
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">IBAN</label>
              <input
                className={inputCls}
                value={iban}
                onChange={(e) => setIban(e.target.value.toUpperCase())}
                disabled={saving}
                dir="ltr"
                placeholder="SA__ ____ ____ ____ ____ ____"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">دور الحساب</label>
              <select
                className={inputCls}
                value={accountRole}
                onChange={(e) => setAccountRole(e.target.value as '' | AccountRole)}
                disabled={saving}
              >
                {ACCOUNT_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                عيّن «الحساب العام» ليتم توزيع دفعات المشتري تلقائيًا على الحسابات الفرعية الثلاثة (انشاءات، اداري وتسويقي، حفظ).
              </p>
            </div>
          </div>
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAdd}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button
              type="button"
              onClick={() => { resetAddForm(); setShowAddForm(false) }}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Bulk upload preview / confirm */}
      {parsing && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          جارٍ قراءة الملف…
        </div>
      )}
      {bulkError && !parsed && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {bulkError}
        </div>
      )}
      {parsed && parsed.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="serif font-bold text-sm text-slate-900">
              معاينة الملف — {parsed.length} صف
            </h3>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>اسم الحساب</Th>
                  <Th>رقم الحساب</Th>
                  <Th>البنك</Th>
                  <Th>IBAN</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsed.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <Td>{r.label}</Td>
                    <Td><span className="font-mono" dir="ltr">{r.account_number ?? '—'}</span></Td>
                    <Td>{r.bank_name ?? '—'}</Td>
                    <Td><span className="font-mono" dir="ltr">{r.iban ?? '—'}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 20 && (
              <div className="px-3 py-2 text-[11px] text-slate-500 bg-slate-50 border-t border-slate-200">
                … و {parsed.length - 20} صف إضافي
              </div>
            )}
          </div>
          {bulkError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {bulkError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={confirmBulkUpload}
              disabled={bulkSaving}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              {bulkSaving ? 'جارٍ الرفع…' : `تأكيد ورفع ${parsed.length} حساب`}
            </button>
            <button
              type="button"
              onClick={cancelBulk}
              disabled={bulkSaving}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Existing accounts list */}
      {initialAccounts.length === 0 ? (
        <div className="text-sm text-slate-500 italic text-center py-6 border border-dashed border-slate-200 rounded-lg">
          لم تُضَف أي حسابات بعد.
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-right">
                <Th>اسم الحساب</Th>
                <Th>الدور</Th>
                <Th>رقم الحساب</Th>
                <Th>البنك</Th>
                <Th>IBAN</Th>
                <Th>إجراء</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {initialAccounts.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 transition">
                  <Td><span className="font-semibold text-slate-900">{a.label}</span></Td>
                  <Td>
                    {a.account_role ? (
                      <span className="inline-flex items-center rounded-md bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200 px-1.5 py-0.5 text-[11px] font-bold">
                        {ROLE_LABEL[a.account_role]}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Td>
                  <Td><span className="font-mono text-xs" dir="ltr">{a.account_number ?? '—'}</span></Td>
                  <Td>{a.bank_name ?? '—'}</Td>
                  <Td><span className="font-mono text-xs" dir="ltr">{a.iban ?? '—'}</span></Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => onDelete(a.id, a.label)}
                      title="حذف الحساب"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-red-700 hover:bg-red-50 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-sm text-slate-700 align-top">{children}</td>
}
