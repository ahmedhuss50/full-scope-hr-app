'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react'
import {
  requestContractUploadUrl,
  registerContract,
  triggerContractExtraction,
} from '../../units/actions'

/**
 * Restore of the contract-PDF upload flow that used to live on the old
 * UnitsSection. Uploads a signed contract PDF to Storage, registers it in
 * dsb_unit_contracts (starts in 'pending'), then fires the vision
 * extractor which will attempt to match the PDF to a unit + sale in this
 * project. The row lands in 'matched' if the extractor identifies the
 * unit, else 'no_match' — the owner can still manually attach unmatched
 * contracts via the buyer-contracts page later.
 *
 * Owner-only. Rendered as a card on the project page.
 */
export function ContractPdfUpload({
  projectId,
  unlinkedCount,
  totalCount,
}: {
  projectId: string
  unlinkedCount: number
  totalCount: number
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function onFile(file: File) {
    setError(null)
    setOkMsg(null)
    setBusy(true)
    try {
      const signRes = await requestContractUploadUrl({
        project_id: projectId,
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

      const regRes = await registerContract({
        project_id: projectId,
        storage_path: signRes.storage_path,
        filename: file.name,
        size: file.size,
      })
      if (!regRes.ok) throw new Error(regRes.error)

      // Fire extraction — non-fatal if it fails, the row stays 'pending'.
      try {
        await triggerContractExtraction({
          contract_id: regRes.contract_id,
          project_id: projectId,
        })
      } catch {
        /* best-effort */
      }

      setOkMsg(`تم رفع «${file.name}». بدأ الذكاء الاصطناعي في قراءة العقد وربطه بالوحدة.`)
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الرفع.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center">
          <FileText className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-slate-900">وثائق العقود (PDF)</div>
          <div className="text-xs text-slate-600 mt-0.5">
            ارفع ملف PDF للعقد؛ الذكاء الاصطناعي يحاول ربطه بالوحدة تلقائيًا.
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
            <span>
              الإجمالي: <span className="font-mono font-bold text-slate-900">{totalCount}</span>
            </span>
            {unlinkedCount > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-amber-700">
                  غير مربوطة: <span className="font-mono font-bold">{unlinkedCount}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {okMsg && (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800 flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{okMsg}</span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white px-3 py-1.5 text-xs font-bold transition"
        >
          {busy ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              جارٍ الرفع…
            </>
          ) : (
            <>
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              رفع عقد PDF
            </>
          )}
        </button>
        <Link
          href={`/app/disbursements/admin/projects/${projectId}/buyer-contracts?linked=no`}
          className="text-[11px] text-slate-500 hover:text-slate-700"
        >
          عرض العقود غير المربوطة
        </Link>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onFile(f)
          }}
        />
      </div>
    </div>
  )
}
