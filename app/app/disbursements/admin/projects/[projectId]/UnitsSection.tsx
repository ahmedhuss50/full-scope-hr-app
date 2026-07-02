'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home,
  Upload,
  Plus,
  Search,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Link as LinkIcon,
  Info,
  Pencil,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import {
  requestContractUploadUrl,
  registerContract,
  updateUnit,
  updateSale,
  deleteUnit,
  attachContractToSale,
  triggerContractExtraction,
  signContractPreviewUrl,
  bulkImportUnitsFromRows,
} from '../../units/actions'

// -----------------------------------------------------------------------------
// Shared types — the server page pre-computes these and passes them in.
// -----------------------------------------------------------------------------

export type UnitRow = {
  id: string
  unit_number: string
  zone_number: string | null
  block_number: string | null
  unit_type: string | null
  area_m2: number | null
  district: string | null
  city: string | null
  region: string | null
  notes: string | null
}

export type SaleRow = {
  id: string
  unit_id: string
  sale_count: number
  sale_status: 'active' | 'cancelled' | 'cancelled_resold' | 'completed' | string
  buyer_name_ar: string | null
  buyer_id_type: string | null
  buyer_id_number: string | null
  buyer_nationality: string | null
  buyer_phone: string | null
  contract_number: string | null
  contract_type: string | null
  financing_type: string | null
  financing_bank: string | null
  sale_date: string | null
  price_before_tax_sar: number | null
  vat_sar: number | null
  price_with_vat_sar: number | null
  delivery_status: string | null
  delivery_date: string | null
  created_at: string
}

export type ContractRow = {
  id: string
  sale_id: string | null
  unit_id: string | null
  filename: string | null
  storage_path: string
  storage_bucket: string
  extraction_status: 'pending' | 'matched' | 'no_match' | 'failed' | string
  extracted_fields: Record<string, unknown> | null
  extracted_at: string | null
  uploaded_at: string
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function UnitsSection({
  projectId,
  units,
  salesByUnitId,
  contractsByUnitId,
  contractsUnlinked,
  latestSaleByUnit,
}: {
  projectId: string
  units: UnitRow[]
  salesByUnitId: Record<string, SaleRow[]>
  contractsByUnitId: Record<string, ContractRow[]>
  contractsUnlinked: ContractRow[]
  latestSaleByUnit: Record<string, SaleRow | null>
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [filter, setFilter] = useState('')
  const [openUnitId, setOpenUnitId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadOk, setUploadOk] = useState<string | null>(null)
  const [showManualAdd, setShowManualAdd] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const filteredUnits = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return units
    return units.filter((u) => {
      const sale = latestSaleByUnit[u.id]
      const hay = [
        u.unit_number,
        u.block_number ?? '',
        u.zone_number ?? '',
        sale?.buyer_name_ar ?? '',
        sale?.buyer_phone ?? '',
        sale?.contract_number ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [units, latestSaleByUnit, filter])

  async function onUploadContract(file: File) {
    setUploadError(null)
    setUploadOk(null)
    setUploading(true)
    try {
      // 1. Ask for a signed upload URL.
      const signRes = await requestContractUploadUrl({
        project_id: projectId,
        filename: file.name,
        size: file.size,
      })
      if (!signRes.ok) throw new Error(signRes.error)

      // 2. PUT to storage.
      const putResp = await fetch(signRes.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      })
      if (!putResp.ok) {
        throw new Error(`فشل رفع الملف إلى التخزين (HTTP ${putResp.status}).`)
      }

      // 3. Register the row.
      const regRes = await registerContract({
        project_id: projectId,
        storage_path: signRes.storage_path,
        filename: file.name,
        size: file.size,
      })
      if (!regRes.ok) throw new Error(regRes.error)

      // 4. Fire the extraction endpoint via a server action. The action is
      // itself fire-and-forget for the /api/dsb-contract-extract call, so
      // this returns quickly. The row stays 'pending' until the background
      // job writes back the match.
      try {
        await triggerContractExtraction({
          contract_id: regRes.contract_id,
          project_id: projectId,
        })
      } catch {
        // Non-fatal — the row is already 'pending' and can be re-triggered.
      }

      setUploadOk('بدأ استخراج بيانات العقد. سيظهر الربط تلقائيًا خلال دقائق.')
      startTransition(() => router.refresh())
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'فشل الرفع.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Home className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <h2 className="serif font-bold text-lg text-slate-900">الوحدات والمشترون</h2>
          <span className="text-xs text-slate-500 font-mono">({units.length})</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            رفع عقد
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void onUploadContract(f)
            }}
          />
          <Link
            href="/app/disbursements/admin/import-units"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            استيراد قائمة الوحدات
          </Link>
          <button
            type="button"
            onClick={() => setShowManualAdd((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            إضافة وحدة يدويًا
          </button>
        </div>
      </div>

      {uploadError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {uploadError}
        </div>
      )}
      {uploadOk && (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 inline-flex items-center gap-2"
        >
          <Info className="w-4 h-4" aria-hidden="true" />
          {uploadOk}
        </div>
      )}

      {showManualAdd && (
        <ManualAddUnitForm
          projectId={projectId}
          onClose={() => setShowManualAdd(false)}
          onSaved={() => {
            setShowManualAdd(false)
            startTransition(() => router.refresh())
          }}
        />
      )}

      {contractsUnlinked.length > 0 && (
        <UnlinkedContractsPanel
          contracts={contractsUnlinked}
          allSales={Object.values(salesByUnitId).flat()}
          unitsById={new Map(units.map((u) => [u.id, u]))}
          onChange={() => startTransition(() => router.refresh())}
        />
      )}

      {/* Search + list */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3">
        <Search className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="بحث برقم الوحدة، اسم العميل، رقم العقد…"
          className="flex-1 bg-transparent text-sm text-slate-900 py-2 focus:outline-none placeholder:text-slate-400"
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

      {filteredUnits.length === 0 ? (
        <div className="text-sm text-slate-500 italic text-center py-8 border border-dashed border-slate-200 rounded-lg">
          {units.length === 0
            ? 'لا توجد وحدات لهذا المشروع بعد.'
            : 'لا نتائج للبحث.'}
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-right">
                <Th>الوحدة</Th>
                <Th>البلوك</Th>
                <Th>المساحة</Th>
                <Th>النوع</Th>
                <Th>العميل الحالي</Th>
                <Th>الجوال</Th>
                <Th>رقم العقد</Th>
                <Th>التسليم</Th>
                <Th>العقود</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUnits.map((u) => {
                const sale = latestSaleByUnit[u.id] ?? null
                const contracts = contractsByUnitId[u.id] ?? []
                return (
                  <tr
                    key={u.id}
                    onClick={() => setOpenUnitId(u.id)}
                    className="hover:bg-slate-50 cursor-pointer transition"
                  >
                    <Td className="font-mono text-xs">{u.unit_number}</Td>
                    <Td>{u.block_number ?? '—'}</Td>
                    <Td>{u.area_m2 != null ? `${u.area_m2}` : '—'}</Td>
                    <Td>{unitTypeLabel(u.unit_type)}</Td>
                    <Td className="max-w-[10rem] truncate">
                      {sale?.buyer_name_ar ?? '—'}
                    </Td>
                    <Td className="font-mono text-xs">
                      <span dir="ltr">{sale?.buyer_phone ?? '—'}</span>
                    </Td>
                    <Td className="font-mono text-xs">
                      {sale?.contract_number ?? '—'}
                    </Td>
                    <Td>{deliveryStatusChip(sale?.delivery_status)}</Td>
                    <Td>
                      {contracts.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                          <LinkIcon className="w-3 h-3" aria-hidden="true" />
                          {contracts.length}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {openUnitId && (
        <UnitDrawer
          unit={units.find((u) => u.id === openUnitId)!}
          sales={salesByUnitId[openUnitId] ?? []}
          contracts={contractsByUnitId[openUnitId] ?? []}
          onClose={() => setOpenUnitId(null)}
          onChange={() => startTransition(() => router.refresh())}
        />
      )}
    </section>
  )
}

// -----------------------------------------------------------------------------
// Manual-add form (single unit)
// -----------------------------------------------------------------------------

function ManualAddUnitForm({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [unitNumber, setUnitNumber] = useState('')
  const [blockNumber, setBlockNumber] = useState('')
  const [zoneNumber, setZoneNumber] = useState('')
  const [unitType, setUnitType] = useState<'villa' | 'apartment' | 'other' | ''>('')
  const [areaM2, setAreaM2] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (!unitNumber.trim()) {
      setError('رقم الوحدة مطلوب.')
      return
    }
    setSaving(true)
    // We reuse the bulk import path with a single-row payload — the server
    // action already handles upsert + tenant isolation. This avoids adding a
    // one-off "createUnit" action just for the manual case.
    const res = await bulkImportUnitsFromRows({
      rows: [
        {
          project_id: projectId,
          unit_number: unitNumber.trim(),
          block_number: blockNumber.trim() || null,
          zone_number: zoneNumber.trim() || null,
          unit_type: unitType || null,
          area_m2: areaM2 ? Number(areaM2) : null,
          sale_status: 'active',
        },
      ],
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onSaved()
  }

  const inp =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/30 p-4 space-y-3">
      <h3 className="serif font-bold text-sm text-slate-900">إضافة وحدة يدويًا</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم الوحدة *</label>
          <input className={inp} value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم البلوك</label>
          <input className={inp} value={blockNumber} onChange={(e) => setBlockNumber(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم المنطقة (Zone)</label>
          <input className={inp} value={zoneNumber} onChange={(e) => setZoneNumber(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">النوع</label>
          <select
            className={inp}
            value={unitType}
            onChange={(e) => setUnitType(e.target.value as 'villa' | 'apartment' | 'other' | '')}
          >
            <option value="">—</option>
            <option value="villa">فيلا</option>
            <option value="apartment">شقة</option>
            <option value="other">أخرى</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">المساحة (م²)</label>
          <input
            className={inp}
            type="number"
            value={areaM2}
            onChange={(e) => setAreaM2(e.target.value)}
            dir="ltr"
          />
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
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Unlinked contracts panel (no_match / failed / pending)
// -----------------------------------------------------------------------------

function UnlinkedContractsPanel({
  contracts,
  allSales,
  unitsById,
  onChange,
}: {
  contracts: ContractRow[]
  allSales: SaleRow[]
  unitsById: Map<string, UnitRow>
  onChange: () => void
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-700" aria-hidden="true" />
        <div className="text-sm font-semibold text-amber-900">
          عقود بحاجة إلى ربط ({contracts.length})
        </div>
      </div>
      <div className="space-y-2">
        {contracts.map((c) => (
          <UnlinkedContractRow
            key={c.id}
            contract={c}
            allSales={allSales}
            unitsById={unitsById}
            onLinked={onChange}
          />
        ))}
      </div>
    </div>
  )
}

function UnlinkedContractRow({
  contract,
  allSales,
  unitsById,
  onLinked,
}: {
  contract: ContractRow
  allSales: SaleRow[]
  unitsById: Map<string, UnitRow>
  onLinked: () => void
}) {
  const [saleId, setSaleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function attach() {
    if (!saleId) return
    setSaving(true)
    setError(null)
    const res = await attachContractToSale({ contract_id: contract.id, sale_id: saleId })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onLinked()
  }

  const badge =
    contract.extraction_status === 'pending'
      ? { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'قيد الاستخراج' }
      : contract.extraction_status === 'failed'
      ? { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'فشل الاستخراج' }
      : { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'بلا مطابقة' }

  return (
    <div className="bg-white rounded-md border border-amber-200 px-3 py-2 flex items-center gap-3 flex-wrap">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${badge.cls}`}
      >
        {badge.label}
      </span>
      <span className="text-xs text-slate-700 truncate max-w-[16rem]" title={contract.filename ?? ''}>
        {contract.filename ?? '—'}
      </span>
      <div className="flex-1 min-w-[12rem]">
        <select
          value={saleId}
          onChange={(e) => setSaleId(e.target.value)}
          disabled={contract.extraction_status === 'pending'}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
        >
          <option value="">— اربط بعملية بيع —</option>
          {allSales.map((s) => {
            const unit = unitsById.get(s.unit_id)
            const label = `وحدة ${unit?.unit_number ?? s.unit_id.slice(0, 6)} · ${s.buyer_name_ar ?? 'بدون اسم'} · #${s.sale_count}`
            return (
              <option key={s.id} value={s.id}>
                {label}
              </option>
            )
          })}
        </select>
      </div>
      <button
        type="button"
        onClick={attach}
        disabled={!saleId || saving || contract.extraction_status === 'pending'}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
        ربط
      </button>
      {error && (
        <div role="alert" className="w-full text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Drawer — unit detail + full sales history + attached contracts
// -----------------------------------------------------------------------------

function UnitDrawer({
  unit,
  sales,
  contracts,
  onClose,
  onChange,
}: {
  unit: UnitRow
  sales: SaleRow[]
  contracts: ContractRow[]
  onClose: () => void
  onChange: () => void
}) {
  const [editingUnit, setEditingUnit] = useState(false)
  const [editUnitNumber, setEditUnitNumber] = useState(unit.unit_number)
  const [editBlock, setEditBlock] = useState(unit.block_number ?? '')
  const [editArea, setEditArea] = useState(unit.area_m2 != null ? String(unit.area_m2) : '')
  const [editNotes, setEditNotes] = useState(unit.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveUnit() {
    setError(null)
    setSaving(true)
    const res = await updateUnit({
      id: unit.id,
      patch: {
        unit_number: editUnitNumber.trim(),
        block_number: editBlock.trim() || null,
        area_m2: editArea ? Number(editArea) : null,
        notes: editNotes.trim() || null,
      },
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditingUnit(false)
    onChange()
  }

  async function removeUnit() {
    if (!confirm(`حذف الوحدة «${unit.unit_number}» وكل عمليات بيعها؟`)) return
    const res = await deleteUnit({ id: unit.id })
    if (!res.ok) {
      alert(res.error)
      return
    }
    onClose()
    onChange()
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/40 flex items-stretch justify-end"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-label={`تفاصيل وحدة ${unit.unit_number}`}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-xl flex flex-col"
        dir="rtl"
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Home className="w-4 h-4 text-slate-500" aria-hidden="true" />
            <h3 className="serif font-bold text-lg text-slate-900 truncate">
              وحدة {unit.unit_number}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100 transition"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Unit specs card */}
          <div className="rounded-lg border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-sm text-slate-900">مواصفات الوحدة</h4>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditingUnit((v) => !v)}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-teal-700 hover:bg-slate-50 transition"
                  title="تعديل"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={removeUnit}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                  title="حذف"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {editingUnit ? (
              <div className="space-y-2 text-sm">
                <LabeledInput
                  label="رقم الوحدة"
                  value={editUnitNumber}
                  onChange={setEditUnitNumber}
                />
                <LabeledInput label="البلوك" value={editBlock} onChange={setEditBlock} />
                <LabeledInput label="المساحة (م²)" value={editArea} onChange={setEditArea} />
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">ملاحظات</label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    rows={2}
                  />
                </div>
                {error && (
                  <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                    {error}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveUnit}
                    disabled={saving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition disabled:opacity-50"
                  >
                    {saving ? 'جارٍ…' : 'حفظ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingUnit(false)}
                    disabled={saving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <SpecCell label="البلوك" value={unit.block_number} />
                <SpecCell label="Zone" value={unit.zone_number} />
                <SpecCell label="النوع" value={unitTypeLabel(unit.unit_type)} />
                <SpecCell label="المساحة" value={unit.area_m2 != null ? `${unit.area_m2} م²` : null} />
                <SpecCell label="الحي" value={unit.district} />
                <SpecCell label="المدينة" value={unit.city} />
                <SpecCell label="المنطقة" value={unit.region} />
                {unit.notes && <SpecCell label="ملاحظات" value={unit.notes} full />}
              </dl>
            )}
          </div>

          {/* Sales history */}
          <div>
            <h4 className="font-semibold text-sm text-slate-900 mb-2">سجل المشترين ({sales.length})</h4>
            {sales.length === 0 ? (
              <div className="text-sm text-slate-500 italic text-center py-6 border border-dashed border-slate-200 rounded-md">
                لا يوجد سجل بيع لهذه الوحدة.
              </div>
            ) : (
              <div className="space-y-2">
                {sales.map((s) => (
                  <SaleCard key={s.id} sale={s} onChange={onChange} />
                ))}
              </div>
            )}
          </div>

          {/* Contracts */}
          <div>
            <h4 className="font-semibold text-sm text-slate-900 mb-2">العقود المرفوعة ({contracts.length})</h4>
            {contracts.length === 0 ? (
              <div className="text-sm text-slate-500 italic text-center py-6 border border-dashed border-slate-200 rounded-md">
                لا عقود مرفوعة لهذه الوحدة.
              </div>
            ) : (
              <ul className="space-y-2">
                {contracts.map((c) => (
                  <li
                    key={c.id}
                    className="border border-slate-200 rounded-md px-3 py-2 flex items-center gap-2 text-xs"
                  >
                    <ContractStatusBadge status={c.extraction_status} />
                    <span className="flex-1 truncate">{c.filename ?? '—'}</span>
                    <ContractPreviewLink contractId={c.id} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function SaleCard({ sale, onChange }: { sale: SaleRow; onChange: () => void }) {
  const [editing, setEditing] = useState(false)
  const [buyerName, setBuyerName] = useState(sale.buyer_name_ar ?? '')
  const [contractNumber, setContractNumber] = useState(sale.contract_number ?? '')
  const [phone, setPhone] = useState(sale.buyer_phone ?? '')
  const [price, setPrice] = useState(sale.price_before_tax_sar != null ? String(sale.price_before_tax_sar) : '')
  const [saleDate, setSaleDate] = useState(sale.sale_date ?? '')
  const [deliveryStatus, setDeliveryStatus] = useState(sale.delivery_status ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const res = await updateSale({
      id: sale.id,
      patch: {
        buyer_name_ar: buyerName.trim() || null,
        contract_number: contractNumber.trim() || null,
        buyer_phone: phone.trim() || null,
        price_before_tax_sar: price ? Number(price) : null,
        sale_date: saleDate || null,
        delivery_status: deliveryStatus || null,
      },
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditing(false)
    onChange()
  }

  return (
    <div className="border border-slate-200 rounded-md p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <SaleStatusBadge status={sale.sale_status} />
          <span className="text-xs text-slate-500 font-mono">#{sale.sale_count}</span>
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-teal-700 hover:bg-slate-50 transition"
          title="تعديل"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <LabeledInput label="اسم العميل" value={buyerName} onChange={setBuyerName} />
          <LabeledInput label="رقم العقد" value={contractNumber} onChange={setContractNumber} />
          <LabeledInput label="الجوال" value={phone} onChange={setPhone} />
          <LabeledInput label="السعر قبل الضريبة" value={price} onChange={setPrice} />
          <LabeledInput label="تاريخ البيع" value={saleDate} onChange={setSaleDate} />
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">حالة التسليم</label>
            <select
              value={deliveryStatus}
              onChange={(e) => setDeliveryStatus(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
            >
              <option value="">—</option>
              <option value="delivered">مُسلَّمة</option>
              <option value="pending">بانتظار</option>
              <option value="other">أخرى</option>
            </select>
          </div>
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition disabled:opacity-50"
            >
              {saving ? 'جارٍ…' : 'حفظ'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <ReadCell label="اسم العميل" value={sale.buyer_name_ar} />
          <ReadCell label="رقم العقد" value={sale.contract_number} />
          <ReadCell label="الجوال" value={sale.buyer_phone} mono />
          <ReadCell label="الجنسية" value={sale.buyer_nationality} />
          <ReadCell label="السعر" value={sale.price_before_tax_sar != null ? `${sale.price_before_tax_sar}` : null} />
          <ReadCell label="تاريخ البيع" value={sale.sale_date} />
          <ReadCell label="التمويل" value={sale.financing_bank ?? sale.financing_type} />
          <ReadCell label="التسليم" value={deliveryStatusLabel(sale.delivery_status)} />
        </dl>
      )}
    </div>
  )
}

function ContractPreviewLink({ contractId }: { contractId: string }) {
  const [loading, setLoading] = useState(false)
  async function open() {
    setLoading(true)
    try {
      const res = await signContractPreviewUrl({ contract_id: contractId })
      if (res.ok) {
        window.open(res.url, '_blank')
      } else {
        alert(res.error)
      }
    } catch {
      alert('تعذّر فتح العقد.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 transition disabled:opacity-50"
      title="فتح العقد"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
      فتح
    </button>
  )
}

// -----------------------------------------------------------------------------
// Small display helpers
// -----------------------------------------------------------------------------

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 mb-1 block">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
      />
    </div>
  )
}

function SpecCell({
  label,
  value,
  full,
}: {
  label: string
  value: string | null | undefined
  full?: boolean
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm text-slate-900">{value ?? '—'}</div>
    </div>
  )
}

function ReadCell({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  return (
    <>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className={`text-xs text-slate-800 truncate ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</dd>
    </>
  )
}

function unitTypeLabel(t: string | null): string {
  if (t === 'villa') return 'فيلا'
  if (t === 'apartment') return 'شقة'
  if (t === 'other') return 'أخرى'
  return '—'
}

function deliveryStatusChip(status: string | null | undefined) {
  if (!status) return <span className="text-slate-400">—</span>
  const map: Record<string, { cls: string; label: string }> = {
    delivered: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'مُسلَّمة' },
    pending: { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'بانتظار' },
    other: { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'أخرى' },
  }
  const s = map[status] ?? map.other!
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  )
}

function deliveryStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null
  if (status === 'delivered') return 'مُسلَّمة'
  if (status === 'pending') return 'بانتظار'
  if (status === 'other') return 'أخرى'
  return status
}

function SaleStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'نشط' },
    cancelled: { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'ملغي' },
    cancelled_resold: { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'ملغي/معاد' },
    completed: { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'منجز' },
  }
  const s = map[status] ?? { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: status }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  )
}

function ContractStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    matched: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'مربوط' },
    no_match: { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'بلا مطابقة' },
    pending: { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'قيد الاستخراج' },
    failed: { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'فشل' },
  }
  const s = map[status] ?? { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: status }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-sm text-slate-700 align-top ${className ?? ''}`}>
      {children}
    </td>
  )
}
