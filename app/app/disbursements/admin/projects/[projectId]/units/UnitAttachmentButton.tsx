'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload, Eye, Check } from 'lucide-react'
import {
  requestUnitDocUploadUrl,
  attachUnitDoc,
  getUnitDocPreviewUrl,
} from '../../../units/actions'

type Kind = 'completion' | 'delivery'

/**
 * Compact per-row uploader for unit-scoped PDFs (completion + delivery
 * certificates). Two-phase upload: signed URL from the server → PUT to
 * storage → attach metadata. Empty rows show an "رفع" button; rows with an
 * existing attachment show a small preview link + a replace button.
 */
export function UnitAttachmentButton({
  unitId,
  kind,
  hasFile,
  filename,
  canEdit,
}: {
  unitId: string
  kind: Kind
  hasFile: boolean
  filename: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  async function onPick(file: File) {
    if (!canEdit) return
    if (file.size > 50 * 1024 * 1024) {
      alert('حجم الملف يتجاوز الحد الأقصى (50 ميغابايت).')
      return
    }
    setBusy(true)
    try {
      const req = await requestUnitDocUploadUrl({
        unit_id: unitId,
        kind,
        filename: file.name,
        size: file.size,
      })
      if (!req.ok) { alert(req.error); return }
      const put = await fetch(req.signed_url, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/pdf' },
        body: file,
      })
      if (!put.ok) { alert('فشل رفع الملف.'); return }
      const att = await attachUnitDoc({
        unit_id: unitId,
        kind,
        storage_path: req.storage_path,
        filename: file.name,
        size: file.size,
      })
      if (!att.ok) { alert(att.error); return }
      setSavedTick((n) => n + 1)
      startTransition(() => router.refresh())
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onPreview() {
    setBusy(true)
    try {
      const res = await getUnitDocPreviewUrl({ unit_id: unitId, kind })
      if (!res.ok) { alert(res.error); return }
      window.open(res.url, '_blank', 'noopener')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f) }}
      />
      {hasFile ? (
        <>
          <button
            type="button"
            onClick={onPreview}
            disabled={busy}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
            title={filename ?? 'عرض'}
          >
            <Eye className="w-3 h-3" /> عرض
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 disabled:opacity-50"
              title="استبدال"
            >
              <Upload className="w-3 h-3" />
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!canEdit || busy}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload className="w-3 h-3" /> رفع
        </button>
      )}
      {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" aria-hidden="true" />}
      {!busy && savedTick > 0 && <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />}
    </div>
  )
}
