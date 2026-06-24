'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PenLine, X, Eraser, Check, Undo2, Stamp } from 'lucide-react'
import type SignaturePad from 'signature_pad'
import {
  signDeliveryDocument,
  getCurrentSignerInfo,
  getSavedSignature,
  saveSignature,
} from '../actions'

/**
 * Sign the delivery-document (وثيقة التسليم).
 *
 * Re-uses the same composite pattern as the main DrawSignatureDialog:
 *   - Editable name / position / date fields, pre-filled from server.
 *   - Signature canvas (mouse / touch / stylus) with per-stroke undo.
 *   - On save, builds a single composite PNG (labels + signature drawn in
 *     Aref Ruqaa handwritten-style Arabic font), sends to the server, which
 *     stores it to Storage and updates the case.
 *
 * Unlike the case PDF signature this does NOT embed in a PDF — the delivery
 * document is rendered as HTML, so the signature is just shown as an <img>
 * inside the "توقيع الإدارة" area on the page.
 */

const AREF_RUQAA_CSS = `
@font-face {
  font-family: 'Aref Ruqaa';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/arefruqaa/v25/WwkbxPW1E165rajQKDulKDwNcNIS2N_8AcQ.woff2) format('woff2');
}
`
let arefRuqaaLoaded: Promise<void> | null = null
function loadArefRuqaa(): Promise<void> {
  if (arefRuqaaLoaded) return arefRuqaaLoaded
  arefRuqaaLoaded = (async () => {
    if (typeof document === 'undefined') return
    if (!document.getElementById('aref-ruqaa-css')) {
      const style = document.createElement('style')
      style.id = 'aref-ruqaa-css'
      style.textContent = AREF_RUQAA_CSS
      document.head.appendChild(style)
    }
    try { await document.fonts.load('24px "Aref Ruqaa"') } catch { /* fallback */ }
  })()
  return arefRuqaaLoaded
}
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
function toArabicDigits(s: string): string { return s.replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d) }
function todayArabic(): string {
  const dt = new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date())
  return toArabicDigits(dt)
}

export function SignDeliveryDocButton({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signerPosition, setSignerPosition] = useState('')
  const [signerDate, setSignerDate] = useState(todayArabic())

  // Saved-signature reuse: see DrawSignatureDialog for full rationale.
  const [savedSignatureDataUrl, setSavedSignatureDataUrl] = useState<string | null>(null)
  const [saveForReuse, setSaveForReuse] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const padRef = useRef<SignaturePad | null>(null)

  // Pre-fill signer info when dialog opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setHasDrawn(false)
    setSignerDate(todayArabic())
    void loadArefRuqaa()
    ;(async () => {
      const [signerRes, savedRes] = await Promise.all([
        getCurrentSignerInfo(),
        getSavedSignature(),
      ])
      if (cancelled) return
      if (signerRes.ok) {
        setSignerName(signerRes.full_name)
        setSignerPosition(signerRes.position_ar)
      }
      if (savedRes.ok) {
        setSavedSignatureDataUrl(savedRes.data_url)
        setSaveForReuse(!savedRes.data_url)
      }
    })()
    return () => { cancelled = true }
  }, [open])

  // Bind signature pad to the canvas.
  useEffect(() => {
    if (!open || !canvasRef.current) return
    let cancelled = false
    ;(async () => {
      const SP = (await import('signature_pad')).default
      if (cancelled || !canvasRef.current) return
      const canvas = canvasRef.current
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      canvas.getContext('2d')?.scale(ratio, ratio)
      const pad = new SP(canvas, {
        backgroundColor: 'rgba(255,255,255,0)',
        // Blue-ink color — same value as the case-PDF signature pad.
        penColor: '#1e3a8a',
        minWidth: 1,
        maxWidth: 2.5,
      })
      pad.addEventListener('endStroke', () => setHasDrawn(!pad.isEmpty()))
      padRef.current = pad
    })()
    return () => { cancelled = true; padRef.current = null }
  }, [open])

  function clearPad() { padRef.current?.clear(); setHasDrawn(false) }
  function undoLastStroke() {
    const pad = padRef.current
    if (!pad) return
    const data = pad.toData()
    if (!data.length) return
    data.pop()
    pad.fromData(data)
    setHasDrawn(data.length > 0)
  }

  /** Paint the user's saved signature onto the pad canvas. Same approach as
   *  DrawSignatureDialog — letter-box preserving aspect, clear pad first. */
  async function useSavedSignature() {
    if (!savedSignatureDataUrl) return
    const canvas = canvasRef.current
    const pad = padRef.current
    if (!canvas || !pad) return
    const img = new Image()
    img.src = savedSignatureDataUrl
    try {
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('saved signature load failed'))
      })
    } catch {
      setError('تعذّر تحميل التوقيع المحفوظ.')
      return
    }
    pad.clear()
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const W = rect.width, H = rect.height
    const fit = Math.min(W / img.width, H / img.height) * 0.95
    const drawW = img.width * fit, drawH = img.height * fit
    const x = (W - drawW) / 2, y = (H - drawH) / 2
    ctx.drawImage(img, x, y, drawW, drawH)
    setHasDrawn(true)
  }

  async function buildComposite(): Promise<string> {
    await loadArefRuqaa()
    const pad = padRef.current
    if (!pad) throw new Error('signature pad missing')
    const sigDataUrl = pad.toDataURL('image/png')
    const sigImg = new Image()
    sigImg.src = sigDataUrl
    await new Promise<void>((res, rej) => {
      sigImg.onload = () => res()
      sigImg.onerror = () => rej(new Error('signature load failed'))
    })

    const ratio = 3
    const W = 520
    const H = 280
    const canvas = document.createElement('canvas')
    canvas.width = W * ratio
    canvas.height = H * ratio
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.clearRect(0, 0, W, H)
    ctx.direction = 'rtl'
    ctx.textAlign = 'right'
    const fontStack = '"Aref Ruqaa", "Amiri", "Times New Roman", serif'
    function drawRow(label: string, value: string, y: number) {
      ctx.font = `20px ${fontStack}`
      ctx.fillStyle = '#475569'
      ctx.fillText(label, W - 12, y)
      const lw = ctx.measureText(label).width
      ctx.font = `22px ${fontStack}`
      ctx.fillStyle = '#0f172a'
      ctx.fillText(value, W - 12 - lw - 6, y)
    }
    drawRow('الاسم:',   signerName || '—',     32)
    drawRow('المنصب:',  signerPosition || '—', 62)
    drawRow('التاريخ:', signerDate || todayArabic(), 92)
    ctx.font = `20px ${fontStack}`
    ctx.fillStyle = '#475569'
    ctx.fillText('التوقيع:', W - 12, 124)

    const sigBoxW = 320
    const sigBoxH = 130
    const sigBoxX = W - 12 - sigBoxW
    const sigBoxY = 130
    const sw = sigImg.width, sh = sigImg.height
    const scale = Math.min(sigBoxW / sw, sigBoxH / sh)
    const drawW = sw * scale, drawH = sh * scale
    const drawX = sigBoxX + (sigBoxW - drawW) / 2
    const drawY = sigBoxY + (sigBoxH - drawH) / 2
    ctx.drawImage(sigImg, drawX, drawY, drawW, drawH)
    return canvas.toDataURL('image/png')
  }

  async function onSign() {
    setError(null)
    if (!padRef.current || padRef.current.isEmpty()) {
      setError('يرجى رسم التوقيع أولًا.')
      return
    }
    if (!signerName.trim() || !signerPosition.trim()) {
      setError('يرجى إدخال الاسم والمنصب.')
      return
    }
    setBusy(true)
    // Capture raw strokes BEFORE building composite — composite bakes in
    // الاسم/المنصب/التاريخ labels which we don't want to persist.
    const rawDataUrl = padRef.current!.toDataURL('image/png')

    let composite: string
    try { composite = await buildComposite() } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'تعذّر بناء التوقيع.')
      return
    }
    const base64 = composite.replace(/^data:image\/png;base64,/, '')
    const res = await signDeliveryDocument({ case_id: caseId, signature_png_base64: base64 })
    if (!res.ok) { setBusy(false); setError(res.error); return }

    if (saveForReuse) {
      const rawB64 = rawDataUrl.replace(/^data:image\/png;base64,/, '')
      try {
        await saveSignature({ signature_png_base64: rawB64 })
      } catch (err) {
        console.warn('[SignDeliveryDocButton] saveSignature failed', err)
      }
    }
    setBusy(false)
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold shadow-sm hover:bg-violet-700 transition print:hidden"
      >
        <PenLine className="w-3.5 h-3.5" aria-hidden="true" />
        وقّع الوثيقة
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 print:hidden">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl overflow-hidden" dir="rtl">
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-200">
          <h3 className="serif font-bold text-base text-slate-900 inline-flex items-center gap-2">
            <PenLine className="w-4 h-4 text-violet-600" aria-hidden="true" />
            توقيع وثيقة التسليم
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

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 mb-1 block">الاسم</label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 mb-1 block">المنصب</label>
              <input
                type="text"
                value={signerPosition}
                onChange={(e) => setSignerPosition(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 mb-1 block">التاريخ</label>
              <input
                type="text"
                value={signerDate}
                onChange={(e) => setSignerDate(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
              <div className="text-xs font-semibold text-slate-700">ارسم توقيعك</div>
              <div className="inline-flex items-center gap-1.5 flex-wrap">
                {savedSignatureDataUrl && (
                  <button
                    type="button"
                    onClick={useSavedSignature}
                    disabled={busy}
                    title="استخدم التوقيع الذي حفظته سابقًا"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-violet-200 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition disabled:opacity-50"
                  >
                    <Stamp className="w-3.5 h-3.5" aria-hidden="true" />
                    استخدم التوقيع المحفوظ
                  </button>
                )}
                <button
                  type="button"
                  onClick={openSignatureUpload}
                  disabled={busy}
                  title="ارفع صورة لتوقيعك (PNG أو JPG) بدلًا من الرسم"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  ارفع صورة التوقيع
                </button>
                <input
                  ref={signatureFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  className="hidden"
                  onChange={onSignatureFilePicked}
                />
              </div>
            </div>
            <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden">
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: 180, touchAction: 'none' }}
                className="block w-full bg-white"
              />
              {!hasDrawn && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                  ارسم التوقيع هنا
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <button
                type="button"
                onClick={undoLastStroke}
                disabled={busy || !hasDrawn}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                تراجع
              </button>
              <button
                type="button"
                onClick={clearPad}
                disabled={busy || !hasDrawn}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                مسح
              </button>
            </div>
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saveForReuse}
                onChange={(e) => setSaveForReuse(e.target.checked)}
                disabled={busy}
                className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span>
                حفظ هذا التوقيع لاستخدامه مرة أخرى في المستقبل
                {savedSignatureDataUrl && (
                  <span className="text-slate-400"> · سيستبدل التوقيع المحفوظ الحالي</span>
                )}
              </span>
            </label>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onSign}
            disabled={busy || !hasDrawn}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {busy ? 'جاري التوقيع…' : 'توقيع وحفظ'}
          </button>
        </div>
      </div>
    </div>
  )
}
