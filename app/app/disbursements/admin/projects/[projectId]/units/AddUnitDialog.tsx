'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'
import { createSingleUnit } from '../../../units/actions'

/**
 * Minimal inline "add a unit" form. Owner + assigned staff can create.
 * Only `unit_number` is required; specs are optional and can be edited
 * later via the drawer/import flow.
 */
export function AddUnitDialog({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [unitNumber, setUnitNumber] = useState('')
  const [unitType, setUnitType]     = useState('')
  const [areaM2, setAreaM2]         = useState('')
  const [block, setBlock]           = useState('')
  const [zone, setZone]             = useState('')
  const [district, setDistrict]     = useState('')
  const [city, setCity]             = useState('')
  const [region, setRegion]         = useState('')
  const [notes, setNotes]           = useState('')

  function reset() {
    setUnitNumber(''); setUnitType(''); setAreaM2(''); setBlock(''); setZone('')
    setDistrict(''); setCity(''); setRegion(''); setNotes(''); setError(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    alert('[1] onSubmit fired — projectId=' + projectId + ', unitNumber=' + unitNumber)
    setError(null); setBusy(true)
    try {
      const res = await createSingleUnit({
        project_id: projectId,
        unit_number: unitNumber.trim(),
        unit_type: unitType.trim() || null,
        area_m2: areaM2 ? Number(areaM2) : null,
        block_number: block.trim() || null,
        zone_number: zone.trim() || null,
        district: district.trim() || null,
        city: city.trim() || null,
        region: region.trim() || null,
        notes: notes.trim() || null,
      })
      setBusy(false)
      alert('[2] server returned: ' + JSON.stringify(res))
      if (!res.ok) {
        setError(res.error)
        return
      }
      reset(); setOpen(false)
      startTransition(() => router.refresh())
    } catch (err) {
      setBusy(false)
      alert('[X] EXCEPTION: ' + String(err))
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        إضافة وحدة
      </button>
    )
  }

  const inputCls = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'
  const labelCls = 'text-xs font-semibold text-slate-600 mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 py-8 px-4" dir="rtl">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="serif font-bold text-lg text-slate-900">إضافة وحدة جديدة</h3>
          <button type="button" onClick={() => { reset(); setOpen(false) }} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-4 space-y-3">
          <div>
            <label className={labelCls}>رقم الوحدة <span className="text-red-500">*</span></label>
            <input className={inputCls} value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} required disabled={busy} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>نوع الوحدة</label><input className={inputCls} value={unitType} onChange={(e) => setUnitType(e.target.value)} disabled={busy} placeholder="villa / apartment" /></div>
            <div><label className={labelCls}>المساحة (م²)</label><input className={inputCls} value={areaM2} onChange={(e) => setAreaM2(e.target.value)} disabled={busy} type="number" step="0.01" /></div>
            <div><label className={labelCls}>رقم البلوك</label><input className={inputCls} value={block} onChange={(e) => setBlock(e.target.value)} disabled={busy} /></div>
            <div><label className={labelCls}>رقم المنطقة (ZONE)</label><input className={inputCls} value={zone} onChange={(e) => setZone(e.target.value)} disabled={busy} /></div>
            <div><label className={labelCls}>الحي</label><input className={inputCls} value={district} onChange={(e) => setDistrict(e.target.value)} disabled={busy} /></div>
            <div><label className={labelCls}>المدينة</label><input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} /></div>
            <div className="col-span-2"><label className={labelCls}>المنطقة</label><input className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy} /></div>
          </div>
          <div><label className={labelCls}>ملاحظات</label><textarea className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} rows={2} /></div>
          {error && (<div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>)}
          <div className="flex items-center gap-2 pt-2">
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {busy ? 'جارٍ الحفظ…' : 'حفظ الوحدة'}
            </button>
            <button type="button" onClick={() => { reset(); setOpen(false) }} disabled={busy} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
