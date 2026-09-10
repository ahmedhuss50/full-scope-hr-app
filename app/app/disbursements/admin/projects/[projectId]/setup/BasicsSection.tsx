'use client'

/**
 * BasicsSection — «الأساسيات» section of تهيئة المشروع.
 *
 * Client component. Renders a compact summary of the project's identity
 * (name, code, developer, status, notes) with a «تعديل» toggle that opens
 * an inline edit form. Wraps the existing `updateProject` server action —
 * no new backend needed for slice 1.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, X } from 'lucide-react'
import { updateProject } from '../../../edit-actions'

type Project = {
  id: string
  code: string
  name_ar: string
  developer_id: string
  status: string | null
  notes: string | null
  // Passed through so we don't nuke bank/checklist state on save.
  bank_name: string | null
  bank_account: string | null
  bank_iban: string | null
  checklist_template_id: string | null
  assigned_employee_id: string | null
  // Migration 066 — REGA (الهيئة العامة للعقار) fields. Populated by the
  // owner during project setup; drive the auto-generated quarterly report
  // package (delivery notice, accountant workbook, etc.).
  rega_license_no: string | null
  rega_agreement_date_hijri: string | null
  rega_agreement_date_gregorian: string | null
  // Migration 068 — accountant workbook Sheet 1 extensions.
  land_price_sar: number | null
  estimated_construction_sar: number | null
  estimated_admin_marketing_sar: number | null
  project_start_date: string | null
  rega_license_expiry_date: string | null
  engineer_consultant_name: string | null
  engineer_consultant_contract_sar: number | null
  contractor_1_name: string | null
  contractor_1_contract_sar: number | null
  contractor_2_name: string | null
  contractor_2_contract_sar: number | null
  contractor_3_name: string | null
  contractor_3_contract_sar: number | null
  contractor_4_name: string | null
  contractor_4_contract_sar: number | null
}
type ClientOpt = { id: string; company_name_ar: string }

const STATUS_OPTIONS: Array<{ value: 'active' | 'archived' | 'inactive'; label: string }> = [
  { value: 'active',   label: 'نشط' },
  { value: 'archived', label: 'مؤرشف' },
  { value: 'inactive', label: 'غير نشط' },
]

function statusLabel(v: string | null): string {
  return STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v ?? '—'
}

export function BasicsSection({
  project,
  developerName,
  clients,
}: {
  project: Project
  developerName: string | null
  clients: ClientOpt[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [code, setCode] = useState(project.code)
  const [nameAr, setNameAr] = useState(project.name_ar)
  const [developerId, setDeveloperId] = useState(project.developer_id)
  const [notes, setNotes] = useState(project.notes ?? '')
  const [status, setStatus] = useState<'active' | 'archived' | 'inactive'>(
    (project.status as 'active' | 'archived' | 'inactive') ?? 'active',
  )
  // REGA fields — drive the auto-generated quarterly report package.
  const [regaLicense, setRegaLicense] = useState(project.rega_license_no ?? '')
  const [regaHijri,   setRegaHijri]   = useState(project.rega_agreement_date_hijri ?? '')
  const [regaGreg,    setRegaGreg]    = useState(project.rega_agreement_date_gregorian ?? '')
  // Migration 068 — accountant workbook Sheet 1 fields.
  const [projectStart,  setProjectStart]  = useState(project.project_start_date ?? '')
  const [licenseExpiry, setLicenseExpiry] = useState(project.rega_license_expiry_date ?? '')
  const [landPrice,     setLandPrice]     = useState(project.land_price_sar != null ? String(project.land_price_sar) : '')
  const [estConstr,     setEstConstr]     = useState(project.estimated_construction_sar != null ? String(project.estimated_construction_sar) : '')
  const [estAdmin,      setEstAdmin]      = useState(project.estimated_admin_marketing_sar != null ? String(project.estimated_admin_marketing_sar) : '')
  const [engName,       setEngName]       = useState(project.engineer_consultant_name ?? '')
  const [engContract,   setEngContract]   = useState(project.engineer_consultant_contract_sar != null ? String(project.engineer_consultant_contract_sar) : '')
  const [c1Name,        setC1Name]        = useState(project.contractor_1_name ?? '')
  const [c1Val,         setC1Val]         = useState(project.contractor_1_contract_sar != null ? String(project.contractor_1_contract_sar) : '')
  const [c2Name,        setC2Name]        = useState(project.contractor_2_name ?? '')
  const [c2Val,         setC2Val]         = useState(project.contractor_2_contract_sar != null ? String(project.contractor_2_contract_sar) : '')
  const [c3Name,        setC3Name]        = useState(project.contractor_3_name ?? '')
  const [c3Val,         setC3Val]         = useState(project.contractor_3_contract_sar != null ? String(project.contractor_3_contract_sar) : '')
  const [c4Name,        setC4Name]        = useState(project.contractor_4_name ?? '')
  const [c4Val,         setC4Val]         = useState(project.contractor_4_contract_sar != null ? String(project.contractor_4_contract_sar) : '')

  function reset() {
    setCode(project.code)
    setNameAr(project.name_ar)
    setDeveloperId(project.developer_id)
    setNotes(project.notes ?? '')
    setStatus((project.status as 'active' | 'archived' | 'inactive') ?? 'active')
    setRegaLicense(project.rega_license_no ?? '')
    setRegaHijri(project.rega_agreement_date_hijri ?? '')
    setRegaGreg(project.rega_agreement_date_gregorian ?? '')
    setProjectStart(project.project_start_date ?? '')
    setLicenseExpiry(project.rega_license_expiry_date ?? '')
    setLandPrice(project.land_price_sar != null ? String(project.land_price_sar) : '')
    setEstConstr(project.estimated_construction_sar != null ? String(project.estimated_construction_sar) : '')
    setEstAdmin(project.estimated_admin_marketing_sar != null ? String(project.estimated_admin_marketing_sar) : '')
    setEngName(project.engineer_consultant_name ?? '')
    setEngContract(project.engineer_consultant_contract_sar != null ? String(project.engineer_consultant_contract_sar) : '')
    setC1Name(project.contractor_1_name ?? '')
    setC1Val(project.contractor_1_contract_sar != null ? String(project.contractor_1_contract_sar) : '')
    setC2Name(project.contractor_2_name ?? '')
    setC2Val(project.contractor_2_contract_sar != null ? String(project.contractor_2_contract_sar) : '')
    setC3Name(project.contractor_3_name ?? '')
    setC3Val(project.contractor_3_contract_sar != null ? String(project.contractor_3_contract_sar) : '')
    setC4Name(project.contractor_4_name ?? '')
    setC4Val(project.contractor_4_contract_sar != null ? String(project.contractor_4_contract_sar) : '')
    setError(null)
  }

  async function onSave() {
    setError(null)
    setSaving(true)
    // Pass through the fields we're not editing here so the server action
    // doesn't clear them. updateProject accepts the full row.
    const res = await updateProject({
      project_id: project.id,
      code: code.trim(),
      name_ar: nameAr.trim(),
      developer_id: developerId,
      assigned_employee_id: project.assigned_employee_id,
      notes: notes.trim() || null,
      status,
      bank_name: project.bank_name,
      bank_account: project.bank_account,
      bank_iban: project.bank_iban,
      checklist_template_id: project.checklist_template_id,
      rega_license_no: regaLicense.trim() || null,
      rega_agreement_date_hijri: regaHijri.trim() || null,
      rega_agreement_date_gregorian: regaGreg.trim() || null,
      project_start_date: projectStart.trim() || null,
      rega_license_expiry_date: licenseExpiry.trim() || null,
      land_price_sar: landPrice.trim() ? Number(landPrice) : null,
      estimated_construction_sar: estConstr.trim() ? Number(estConstr) : null,
      estimated_admin_marketing_sar: estAdmin.trim() ? Number(estAdmin) : null,
      engineer_consultant_name: engName.trim() || null,
      engineer_consultant_contract_sar: engContract.trim() ? Number(engContract) : null,
      contractor_1_name: c1Name.trim() || null,
      contractor_1_contract_sar: c1Val.trim() ? Number(c1Val) : null,
      contractor_2_name: c2Name.trim() || null,
      contractor_2_contract_sar: c2Val.trim() ? Number(c2Val) : null,
      contractor_3_name: c3Name.trim() || null,
      contractor_3_contract_sar: c3Val.trim() ? Number(c3Val) : null,
      contractor_4_name: c4Name.trim() || null,
      contractor_4_contract_sar: c4Val.trim() ? Number(c4Val) : null,
    })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  if (!open) {
    return (
      <>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm min-w-0 flex-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <dt className="text-slate-500 text-xs">الاسم:</dt>
              <dd className="font-semibold text-slate-900 truncate">{project.name_ar}</dd>
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <dt className="text-slate-500 text-xs">الرمز:</dt>
              <dd className="font-mono text-slate-800 truncate" dir="ltr">{project.code}</dd>
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <dt className="text-slate-500 text-xs">العميل:</dt>
              <dd className="text-slate-800 truncate">{developerName ?? '—'}</dd>
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <dt className="text-slate-500 text-xs">الحالة:</dt>
              <dd className="text-slate-800">{statusLabel(project.status)}</dd>
            </div>
            {project.rega_license_no && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-slate-500 text-xs">رخصة REGA:</dt>
                <dd className="font-mono text-slate-800 truncate" dir="ltr">{project.rega_license_no}</dd>
              </div>
            )}
            {project.rega_agreement_date_hijri && (
              <div className="flex items-baseline gap-2 min-w-0">
                <dt className="text-slate-500 text-xs">تاريخ الاتفاقية (هـ):</dt>
                <dd className="text-slate-800 truncate">{project.rega_agreement_date_hijri}</dd>
              </div>
            )}
            {project.notes && (
              <div className="sm:col-span-2 flex items-baseline gap-2 min-w-0">
                <dt className="text-slate-500 text-xs">ملاحظات:</dt>
                <dd className="text-slate-700 truncate">{project.notes}</dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            تعديل
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم المشروع *</label>
          <input className={inputCls} value={nameAr} onChange={(e) => setNameAr(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رمز المشروع *</label>
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">العميل *</label>
          <select className={inputCls} value={developerId} onChange={(e) => setDeveloperId(e.target.value)} disabled={saving}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name_ar}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">الحالة</label>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'archived' | 'inactive')} disabled={saving}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-slate-500 mb-1 block">ملاحظات</label>
          <textarea rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
        </div>
        {/* REGA identifiers — needed to generate the quarterly delivery
            notice + accountant workbook. All three optional; missing
            fields render as «لم يُعبَّأ» in the generated document. */}
        <div className="sm:col-span-2 pt-2 mt-1 border-t border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            بيانات REGA (الهيئة العامة للعقار)
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم رخصة المشروع (REGA)</label>
          <input className={inputCls} value={regaLicense} onChange={(e) => setRegaLicense(e.target.value)} disabled={saving} dir="ltr" placeholder="مثال: أ/208" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">تاريخ اتفاقية REGA (هجري)</label>
          <input className={inputCls} value={regaHijri} onChange={(e) => setRegaHijri(e.target.value)} disabled={saving} placeholder="مثال: 02 /07/1445هـ" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">تاريخ اتفاقية REGA (ميلادي)</label>
          <input type="date" className={inputCls} value={regaGreg} onChange={(e) => setRegaGreg(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">تاريخ بدء المشروع</label>
          <input type="date" className={inputCls} value={projectStart} onChange={(e) => setProjectStart(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">تاريخ انتهاء الترخيص</label>
          <input type="date" className={inputCls} value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} disabled={saving} dir="ltr" />
        </div>

        {/* Estimated costs — feed variance analysis on Sheet 5 */}
        <div className="sm:col-span-2 pt-2 mt-1 border-t border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            التكاليف التقديرية (دراسة الجدوى)
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">سعر الأرض (ر.س)</label>
          <input type="number" step="0.01" className={inputCls} value={landPrice} onChange={(e) => setLandPrice(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">التكاليف الإنشائية التقديرية (ر.س)</label>
          <input type="number" step="0.01" className={inputCls} value={estConstr} onChange={(e) => setEstConstr(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-slate-500 mb-1 block">التكاليف الإدارية والتسويقية التقديرية (ر.س)</label>
          <input type="number" step="0.01" className={inputCls} value={estAdmin} onChange={(e) => setEstAdmin(e.target.value)} disabled={saving} dir="ltr" />
        </div>

        {/* Engineer consultant */}
        <div className="sm:col-span-2 pt-2 mt-1 border-t border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            الاستشاري الهندسي
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم الاستشاري الهندسي</label>
          <input className={inputCls} value={engName} onChange={(e) => setEngName(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">قيمة عقد الاستشاري (ر.س)</label>
          <input type="number" step="0.01" className={inputCls} value={engContract} onChange={(e) => setEngContract(e.target.value)} disabled={saving} dir="ltr" />
        </div>

        {/* Contractors — up to 4 */}
        <div className="sm:col-span-2 pt-2 mt-1 border-t border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            المقاولون (حتى 4)
          </div>
        </div>
        {([
          ['اسم المقاول 1',   'قيمة عقد المقاول 1', c1Name, setC1Name, c1Val, setC1Val],
          ['اسم المقاول 2',   'قيمة عقد المقاول 2', c2Name, setC2Name, c2Val, setC2Val],
          ['اسم المقاول 3',   'قيمة عقد المقاول 3', c3Name, setC3Name, c3Val, setC3Val],
          ['اسم المقاول 4',   'قيمة عقد المقاول 4', c4Name, setC4Name, c4Val, setC4Val],
        ] as Array<[string, string, string, (v: string) => void, string, (v: string) => void]>).map(([nLabel, vLabel, nVal, setN, vVal, setV], i) => (
          <div key={i} className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">{nLabel}</label>
              <input className={inputCls} value={nVal} onChange={(e) => setN(e.target.value)} disabled={saving} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">{vLabel} (ر.س)</label>
              <input type="number" step="0.01" className={inputCls} value={vVal} onChange={(e) => setV(e.target.value)} disabled={saving} dir="ltr" />
            </div>
          </div>
        ))}
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          إلغاء
        </button>
      </div>
    </div>
  )
}
