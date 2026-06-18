'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PenLine, X, Eraser, Check, Undo2, ChevronRight, ChevronLeft } from 'lucide-react'
import {
  signCaseWithDrawnSignature,
  getCurrentUploadSignedUrl,
  getCurrentSignerInfo,
} from './actions'
import type SignaturePad from 'signature_pad'

// Aref Ruqaa — Google Font, handwritten-style Arabic. Loaded once and cached
// in the browser. Falls back gracefully to system fonts if blocked.
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
    try {
      await document.fonts.load('24px "Aref Ruqaa"')
    } catch {
      /* swallow — fallback fonts will be used */
    }
  })()
  return arefRuqaaLoaded
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
function toArabicDigits(s: string): string {
  return s.replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d)
}
function todayArabic(): string {
  const now = new Date()
  // Saudi locale, long month name, Riyadh time zone.
  const dt = new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)
  return toArabicDigits(dt)
}

/**
 * In-app draw-to-sign with click-to-place positioning.
 *
 * Flow:
 *   1. Modal opens; we fetch a signed URL for the case's PDF.
 *   2. PDF.js renders pages to canvases the user can navigate (next / prev).
 *   3. User clicks anywhere on a page to drop a signature marker (red box
 *      showing where the signature will end up).
 *   4. They draw the signature in the pad below; "تراجع" pops the last
 *      stroke, "مسح" clears.
 *   5. "توقيع وحفظ" sends signature PNG + page index + (x_frac, y_frac) in
 *      browser coords (top-left origin) to the server, which embeds via
 *      pdf-lib at the chosen location.
 *
 * If the user skips picking a spot, the server falls back to bottom-right
 * of the last page.
 */
type Marker = { page: number; xFrac: number; yFrac: number }

export function DrawSignatureDialog({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Signer block fields. Pre-fill name/position from getCurrentSignerInfo on
  // first open; user can edit either before saving. Date is auto-today and
  // not editable (the system records WHEN you signed).
  const [signerName, setSignerName] = useState('')
  const [signerPosition, setSignerPosition] = useState('')
  const [signerDate, setSignerDate] = useState('')

  // PDF state
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfDoc, setPdfDoc] = useState<{
    numPages: number
    getPage: (n: number) => Promise<{
      getViewport: (o: { scale: number }) => { width: number; height: number }
      render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> }
    }>
  } | null>(null)
  const [pageIndex, setPageIndex] = useState(0) // 0-based
  const [pageDims, setPageDims] = useState<{ width: number; height: number } | null>(null)
  const [marker, setMarker] = useState<Marker | null>(null)
  const [hasDrawn, setHasDrawn] = useState(false)

  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const pdfContainerRef = useRef<HTMLDivElement | null>(null)
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const padRef = useRef<SignaturePad | null>(null)

  // ----- Fetch the case PDF + signer info when dialog opens -----
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setPdfUrl(null)
    setPdfDoc(null)
    setPageIndex(0)
    setMarker(null)
    setHasDrawn(false)
    setSignerDate(todayArabic())
    // Preload the handwritten-style Arabic font so it's ready when we render
    // the composite canvas later.
    void loadArefRuqaa()
    ;(async () => {
      const [pdfRes, signerRes] = await Promise.all([
        getCurrentUploadSignedUrl({ case_id: caseId }),
        getCurrentSignerInfo(),
      ])
      if (cancelled) return
      if (!pdfRes.ok) {
        setError(pdfRes.error)
        return
      }
      setPdfUrl(pdfRes.url)
      if (signerRes.ok) {
        setSignerName(signerRes.full_name)
        setSignerPosition(signerRes.position_ar)
      }
    })()
    return () => { cancelled = true }
  }, [open, caseId])

  // ----- Load PDF.js + open the document -----
  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false
    ;(async () => {
      // pdfjs-dist ships a worker we have to point the lib at. Using a CDN
      // build keeps us from having to configure webpack worker loaders.
      const pdfjsLib = await import('pdfjs-dist')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lib = pdfjsLib as any
      lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.mjs`
      try {
        const loadingTask = lib.getDocument(pdfUrl)
        const doc = await loadingTask.promise
        if (cancelled) return
        setPdfDoc(doc)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'فشل تحميل الـPDF')
      }
    })()
    return () => { cancelled = true }
  }, [pdfUrl])

  // ----- Render the current page -----
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    ;(async () => {
      const page = await pdfDoc.getPage(pageIndex + 1) // pdfjs is 1-indexed
      if (cancelled || !pdfCanvasRef.current) return
      const containerW = pdfContainerRef.current?.clientWidth ?? 600
      // Render at a scale that fits the container while staying readable.
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(containerW / base.width, 1.8)
      const viewport = page.getViewport({ scale })
      const canvas = pdfCanvasRef.current
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport }).promise
      if (cancelled) return
      setPageDims({ width: viewport.width, height: viewport.height })
    })()
    return () => { cancelled = true }
  }, [pdfDoc, pageIndex])

  // ----- Bind signature_pad to the signing canvas -----
  useEffect(() => {
    if (!open || !signatureCanvasRef.current) return
    let cancelled = false
    ;(async () => {
      const SP = (await import('signature_pad')).default
      if (cancelled || !signatureCanvasRef.current) return
      const canvas = signatureCanvasRef.current
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      canvas.getContext('2d')?.scale(ratio, ratio)
      const pad = new SP(canvas, {
        backgroundColor: 'rgba(255,255,255,0)',
        penColor: '#0f172a',
        minWidth: 1,
        maxWidth: 2.5,
      })
      pad.addEventListener('endStroke', () => setHasDrawn(!pad.isEmpty()))
      padRef.current = pad
    })()
    return () => { cancelled = true; padRef.current = null }
  }, [open])

  function onPdfClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setMarker({
      page: pageIndex,
      xFrac: x / rect.width,
      yFrac: y / rect.height,
    })
  }

  function clearPad() {
    padRef.current?.clear()
    setHasDrawn(false)
  }

  function undoLastStroke() {
    const pad = padRef.current
    if (!pad) return
    const data = pad.toData()
    if (!data.length) return
    data.pop()
    pad.fromData(data)
    setHasDrawn(data.length > 0)
  }

  /**
   * Build a composite signature image (PNG data URL) that contains the
   * three labels (الاسم / المنصب / التاريخ) rendered in a handwritten-style
   * Arabic font + the drawn signature underneath. Composite is what gets
   * embedded in the PDF, so position/sizing of the whole block is consistent.
   */
  async function buildCompositeSignature(): Promise<string> {
    await loadArefRuqaa()
    const pad = padRef.current
    if (!pad) throw new Error('signature pad missing')
    const signatureDataUrl = pad.toDataURL('image/png')
    const sigImg = new Image()
    sigImg.src = signatureDataUrl
    await new Promise<void>((resolve, reject) => {
      sigImg.onload = () => resolve()
      sigImg.onerror = () => reject(new Error('signature load failed'))
    })

    // Use a high-DPI canvas so the composite stays crisp when the PDF is
    // viewed at high zoom levels.
    const ratio = 3
    const W = 520
    const H = 280
    const canvas = document.createElement('canvas')
    canvas.width = W * ratio
    canvas.height = H * ratio
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    // Transparent background — the PDF page color shows through.
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0f172a'
    ctx.direction = 'rtl'
    ctx.textAlign = 'right'

    const fontStack = '"Aref Ruqaa", "Amiri", "Times New Roman", serif'
    const labelSize = 20
    const valueSize = 22

    function drawRow(labelAr: string, value: string, y: number) {
      // Label in bold-ish smaller; value larger to feel more handwritten.
      ctx.font = `${labelSize}px ${fontStack}`
      ctx.fillStyle = '#475569'
      ctx.fillText(labelAr, W - 12, y)
      const labelW = ctx.measureText(labelAr).width
      ctx.font = `${valueSize}px ${fontStack}`
      ctx.fillStyle = '#0f172a'
      ctx.fillText(value, W - 12 - labelW - 6, y)
    }

    drawRow('الاسم:',   signerName  || '—',     32)
    drawRow('المنصب:',  signerPosition || '—',  62)
    drawRow('التاريخ:', signerDate || todayArabic(), 92)

    // Signature label + image.
    ctx.font = `${labelSize}px ${fontStack}`
    ctx.fillStyle = '#475569'
    ctx.fillText('التوقيع:', W - 12, 124)

    // Place signature image at top-right, leaving room for label.
    const sigBoxW = 320
    const sigBoxH = 130
    const sigBoxX = W - 12 - sigBoxW
    const sigBoxY = 130
    // Letter-box the signature inside (preserve aspect).
    const sw = sigImg.width
    const sh = sigImg.height
    const scale = Math.min(sigBoxW / sw, sigBoxH / sh)
    const drawW = sw * scale
    const drawH = sh * scale
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
    if (!signerName.trim()) {
      setError('يرجى إدخال الاسم.')
      return
    }
    if (!signerPosition.trim()) {
      setError('يرجى إدخال المنصب.')
      return
    }
    if (!marker) {
      setError('يرجى تحديد مكان التوقيع بالضغط على الوثيقة أولًا.')
      return
    }

    setBusy(true)
    let compositeDataUrl: string
    try {
      compositeDataUrl = await buildCompositeSignature()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'تعذّر بناء صورة التوقيع.')
      return
    }
    const base64 = compositeDataUrl.replace(/^data:image\/png;base64,/, '')

    const res = await signCaseWithDrawnSignature({
      case_id: caseId,
      signature_png_base64: base64,
      page_index: marker.page,
      x_frac: marker.xFrac,
      y_frac: marker.yFrac,
      // Larger width because the block now includes labels + signature.
      width_frac: 0.32,
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
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold shadow-sm hover:bg-violet-700 transition"
      >
        <PenLine className="w-4 h-4" aria-hidden="true" />
        توقيع إلكتروني
      </button>
    )
  }

  // Compute marker pixel position over the PDF canvas.
  const markerOnThisPage = marker && marker.page === pageIndex && pageDims
    ? {
        left: marker.xFrac * pageDims.width,
        top: marker.yFrac * pageDims.height,
      }
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-4xl max-h-[95vh] flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden" dir="rtl">
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-200 shrink-0">
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

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            تصفّح الصفحات واضغط على المكان الذي تريد وضع التوقيع فيه، ثم ارسم توقيعك في الأسفل واحفظ.
          </p>

          {/* PDF viewer */}
          <div ref={pdfContainerRef} className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
            {pdfDoc ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => { setPageIndex((i) => Math.max(0, i - 1)); setMarker(null) }}
                  disabled={pageIndex === 0}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                  السابقة
                </button>
                <div className="text-xs font-mono text-slate-600">
                  صفحة {pageIndex + 1} من {pdfDoc.numPages}
                </div>
                <button
                  type="button"
                  onClick={() => { setPageIndex((i) => Math.min(pdfDoc.numPages - 1, i + 1)); setMarker(null) }}
                  disabled={pageIndex >= pdfDoc.numPages - 1}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  التالية
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                جارٍ تحميل الوثيقة…
              </div>
            )}

            <div className="relative max-h-[55vh] overflow-auto">
              <div className="relative inline-block" dir="ltr">
                <canvas
                  ref={pdfCanvasRef}
                  onClick={onPdfClick}
                  className="block cursor-crosshair"
                />
                {markerOnThisPage && (
                  <div
                    className="pointer-events-none absolute border-2 border-violet-500 bg-violet-500/10 rounded-sm"
                    style={{
                      left: markerOnThisPage.left - 60,
                      top: markerOnThisPage.top - 24,
                      width: 120,
                      height: 48,
                    }}
                  >
                    <div className="absolute -top-5 right-0 text-[10px] font-semibold bg-violet-600 text-white px-1.5 py-0.5 rounded">
                      هنا
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Signer block fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 mb-1 block">الاسم</label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 mb-1 block">المنصب</label>
              <input
                type="text"
                value={signerPosition}
                onChange={(e) => setSignerPosition(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 mb-1 block">التاريخ</label>
              <input
                type="text"
                value={signerDate}
                onChange={(e) => setSignerDate(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
              />
            </div>
          </div>

          {/* Signature pad */}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1.5">ارسم توقيعك</div>
            <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden">
              <canvas
                ref={signatureCanvasRef}
                style={{ width: '100%', height: 180, touchAction: 'none' }}
                className="block w-full bg-white"
              />
              {!hasDrawn && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                  ارسم التوقيع هنا
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={undoLastStroke}
                  disabled={busy || !hasDrawn}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                >
                  <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                  تراجع
                </button>
                <button
                  type="button"
                  onClick={clearPad}
                  disabled={busy || !hasDrawn}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                >
                  <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                  مسح
                </button>
              </div>
              <div className="text-[11px] text-slate-500">
                {marker
                  ? `سيُوضع التوقيع في الصفحة ${marker.page + 1} عند المكان المختار`
                  : 'اضغط على الوثيقة لتحديد مكان التوقيع'}
              </div>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
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
            disabled={busy || !hasDrawn || !marker}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {busy ? 'جاري التوقيع…' : 'توقيع وحفظ'}
          </button>
        </div>
      </div>
    </div>
  )
}
