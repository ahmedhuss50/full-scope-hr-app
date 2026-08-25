'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, Trash2, Search, Loader2 } from 'lucide-react'
import { updateProjectAccount, deleteProjectAccount } from '../edit-actions'

// Migration 063 — one of the four escrow-mandated slots this account
// occupies. Null = ordinary account (not part of a project's escrow split).
export type AccountRole = 'general' | 'construction' | 'admin_marketing' | 'escrow'

const ACCOUNT_ROLE_OPTIONS: Array<{ value: '' | AccountRole; label: string }> = [
  { value: '',                label: '— (بدون دور)' },
  { value: 'general',         label: 'الحساب العام' },
  { value: 'construction',    label: 'الانشاءات' },
  { value: 'admin_marketing', label: 'الاداري والتسويقي' },
  { value: 'escrow',          label: 'الحفظ' },
]

const ROLE_LABEL: Record<AccountRole, string> = {
  general:         'الحساب العام',
  construction:    'الانشاءات',
  admin_marketing: 'الاداري والتسويقي',
  escrow:          'الحفظ',
}

export type AccountRow = {
  id: string
  projectId: string
  projectNameAr: string
  developerNameAr: string | null
  label: string
  accountNumber: string | null
  bankName: string | null
  iban: string | null
  accountRole: AccountRole | null
  createdAt: string
}

export type ProjectOption = {
  id: string
  name_ar: string
  developer_name_ar: string | null
}

/**
 * Tenant-wide accounts list. Each row toggles into edit mode (pencil) where
 * the project becomes a searchable dropdown grouped by developer, and the
 * label / number / bank / IBAN become text inputs. Save / cancel / delete.
 */
export function AccountsListEditor({
  accounts,
  projects,
}: {
  accounts: AccountRow[]
  projects: ProjectOption[]
}) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter((a) =>
      [a.label, a.projectNameAr, a.developerNameAr ?? '', a.accountNumber ?? '', a.bankName ?? '', a.iban ?? '']
        .some((v) => v.toLowerCase().includes(q)),
    )
  }, [filter, accounts])

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="بحث في الحسابات (الاسم، رقم الحساب، البنك، المشروع، العميل)…"
            className="flex-1 bg-transparent text-sm text-slate-900 focus:outline-none placeholder:text-slate-400"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              aria-label="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500 shadow-sm">
          {accounts.length === 0
            ? 'لا توجد حسابات مُعرَّفة بعد.'
            : 'لا توجد نتائج مطابقة للبحث.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>اسم الحساب</Th>
                  <Th>المشروع</Th>
                  <Th>العميل</Th>
                  <Th>الدور</Th>
                  <Th>رقم الحساب</Th>
                  <Th>البنك</Th>
                  <Th>IBAN</Th>
                  <Th>الإجراء</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((a) => (
                  <EditableRow key={a.id} account={a} projects={projects} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function EditableRow({
  account,
  projects,
}: {
  account: AccountRow
  projects: ProjectOption[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Drafts mirror the persisted values; reset every time we enter edit mode.
  const [label, setLabel] = useState(account.label)
  const [projectId, setProjectId] = useState(account.projectId)
  const [accountNumber, setAccountNumber] = useState(account.accountNumber ?? '')
  const [bankName, setBankName] = useState(account.bankName ?? '')
  const [iban, setIban] = useState(account.iban ?? '')
  const [accountRole, setAccountRole] = useState<'' | AccountRole>(account.accountRole ?? '')

  function startEdit() {
    setError(null)
    setLabel(account.label)
    setProjectId(account.projectId)
    setAccountNumber(account.accountNumber ?? '')
    setBankName(account.bankName ?? '')
    setIban(account.iban ?? '')
    setAccountRole(account.accountRole ?? '')
    setEditing(true)
  }

  function cancel() {
    setError(null)
    setEditing(false)
  }

  async function save() {
    setError(null)
    setSaving(true)
    const res = await updateProjectAccount({
      id: account.id,
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
    setEditing(false)
    startTransition(() => router.refresh())
  }

  async function onDelete() {
    if (!confirm(`حذف الحساب «${account.label}»؟ سيتم فصله عن أي طلبات تشير إليه.`)) return
    setDeleting(true)
    const res = await deleteProjectAccount({ id: account.id })
    setDeleting(false)
    if (!res.ok) {
      alert(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  // Render
  const selectedProject = projects.find((p) => p.id === projectId)
  return (
    <tr className="hover:bg-slate-50 transition align-top">
      <Td>
        {editing ? (
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={saving}
            className={inputCls}
          />
        ) : (
          <span className="font-semibold text-slate-900">{account.label}</span>
        )}
      </Td>
      <Td>
        {editing ? (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={saving}
            className={inputCls}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.developer_name_ar ? `${p.developer_name_ar} · ${p.name_ar}` : p.name_ar}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-slate-900">{account.projectNameAr}</span>
        )}
      </Td>
      <Td>
        <span className="text-slate-700">
          {editing ? (selectedProject?.developer_name_ar ?? '—') : (account.developerNameAr ?? '—')}
        </span>
      </Td>
      <Td>
        {editing ? (
          <select
            value={accountRole}
            onChange={(e) => setAccountRole(e.target.value as '' | AccountRole)}
            disabled={saving}
            className={inputCls}
          >
            {ACCOUNT_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : account.accountRole ? (
          <span className="inline-flex items-center rounded-md bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200 px-1.5 py-0.5 text-[11px] font-bold">
            {ROLE_LABEL[account.accountRole]}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </Td>
      <Td>
        {editing ? (
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            disabled={saving}
            className={inputCls}
            dir="ltr"
          />
        ) : (
          <span className="font-mono text-xs">{account.accountNumber ?? '—'}</span>
        )}
      </Td>
      <Td>
        {editing ? (
          <input
            type="text"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            disabled={saving}
            className={inputCls}
          />
        ) : (
          <span>{account.bankName ?? '—'}</span>
        )}
      </Td>
      <Td>
        {editing ? (
          <input
            type="text"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            disabled={saving}
            className={inputCls}
            dir="ltr"
          />
        ) : (
          <span className="font-mono text-xs">{account.iban ?? '—'}</span>
        )}
      </Td>
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
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {saving ? '...' : 'حفظ'}
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                إلغاء
              </button>
            </div>
            {error && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700 max-w-[14rem]">
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={startEdit}
              title="تعديل"
              className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-teal-700 hover:bg-slate-50 transition"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              title="حذف"
              className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-50"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </Td>
    </tr>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

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
