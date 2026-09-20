'use client'

/**
 * Error boundary for the vendors page — catches any server render crash
 * and renders a friendly Arabic message with a retry button, instead of
 * Next's generic white "Application error" screen. The full message is
 * logged to the browser console for debugging.
 */
import { useEffect } from 'react'

export default function VendorsPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[vendors page error]', error)
  }, [error])

  return (
    <div className="max-w-2xl mx-auto mt-10 p-6 border border-red-200 bg-red-50 rounded-xl text-right" dir="rtl">
      <h1 className="serif font-bold text-xl text-red-900 mb-2">
        تعذّر تحميل صفحة الموردين
      </h1>
      <p className="text-sm text-red-800 mb-3">
        حدث خطأ أثناء تحميل الصفحة. تفاصيل تقنية أدناه — أرسلها للمطوّر
        إذا استمرّت المشكلة.
      </p>
      <div className="bg-white border border-red-200 rounded-lg p-3 mb-3 text-[11px] font-mono text-red-900 whitespace-pre-wrap break-all leading-relaxed">
        <div><strong>Message:</strong> {String(error?.message ?? '—')}</div>
        {error?.digest && <div className="mt-1"><strong>Digest:</strong> {error.digest}</div>}
        {error?.stack && (
          <details className="mt-2">
            <summary className="cursor-pointer">Stack</summary>
            <pre className="mt-1 text-[10px]">{error.stack}</pre>
          </details>
        )}
      </div>
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700"
      >
        إعادة المحاولة
      </button>
    </div>
  )
}
