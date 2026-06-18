'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PenLine, X, Eraser, Check } from 'lucide-react'
import { signCaseWithDrawnSignature } from './actions'

/**
 * In-app draw-to-sign for the owner.
 *
 * Opens a modal with a signature canvas (mouse, trackpad, finger, or stylus).
 * The drawn PNG is sent to the server which uses pdf-lib to embed it at the
 * bottom-right of the case's last PDF page, then marks the case signed.
 *
 * We dynamically import signature_pad inside useEffect so it stays out of the
 * SSR bundle and only loads when the dialog actually opens.
 */
export function DrawSignatureDialog({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasDrawn, setHasDrawn] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // The pad lives in a ref so the React render cycle doesn't recreate it.
  const padRef = useRef<{
    clear: () => void
    isEmpty: () => boolean
    toDataURL: (mime?: string) => string
  } | null>(null)

  // Load + bind signature_pad after the canvas mounts.
  useEffect(() => {
    if (!open || !canvasRef.current) return
    let cancelled = false
    ;(async () => {
      const SignaturePad = (await import('signature_pad')).default
      if (cancelled || !canvasRef.current) return

      // High-DPI scaling so the signature renders crisp on retina screens.
      const canvas = canvasRef.current
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      const ctx = canvas.getContext('2d')
      ctx?.scale(ratio, ratio)

      const pad = new SignaturePad(canvas, {
        backgroundColor: 'rgba(255,255,255,0)',
        penColor: '#0f172a',
        minWidth: 1,
        maxWidth: 2.5,
      })
      pad.addEventListener('endStroke', () => setHasDrawn(!pad.isEmpty()))
      padRef.current = pad
    })()
    return () => {
      cancelled = true
      padRef.current = null
    }
  }, [open])

  function clearPad() {
    padRef.current?.clear()
    setHasDrawn(false)
  }

  async function onSign() {
    setError(null)
    if (!padRef.current || padRef.current.isEmpty()) {
      setError('يرجى رسم التوقيع أولًا.')
      return
    }
    // PNG with transparent background — flatter to embed on the PDF.
    const dataUrl = padRef.current.toDataURL('image/png')
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    setBusy(true)
    const res = await signCaseWithDrawnSignature({
      case_id: caseId,
      signature_png_base64: base64,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setHasDrawn(false); setError(null); setOpen(true) }}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold shadow-sm hover:bg-violet-700 transition"
      >
        <PenLine className="w-4 h-4" aria-hidden="true" />
        توقيع إلكتروني
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl overflow-hidden" dir="rtl">
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-200">
          <h3 className="serif font-bold text-base text-slate-900 inline-flex items-center gap-2">
            <PenLine className="w-4 h-4 text-violet-600" aria-hidden="true" />
            التوقيع الإلكتروني
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-600 leading-relaxed">
            ارسم توقيعك في الإطار أدناه (يمكنك استخدام الفأرة أو شاشة اللمس أو القلم الرقمي). سيتم إضافة التوقيع تلقائيًا أسفل الصفحة الأخيرة من ملف PDF وحفظ النسخة الموقّعة في الطلب.
          </p>

          <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden">
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: 220, touchAction: 'none' }}
              className="block w-full bg-white"
            />
            {!hasDrawn && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                ارسم التوقيع هنا
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={clearPad}
              disabled={busy || !hasDrawn}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
              مسح
            </button>
            <div className="text-[11px] text-slate-500">
              سيُحفظ التوقيع في أسفل الصفحة الأخيرة من ملف الـPDF
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={onSign}
              disabled={busy || !hasDrawn}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              {busy ? 'جاري التوقيع…' : 'توقيع وحفظ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
