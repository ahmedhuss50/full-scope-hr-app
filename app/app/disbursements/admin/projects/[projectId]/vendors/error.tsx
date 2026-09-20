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
        حدث خطأ أثناء جلب البيانات. غالبًا يعني هذا أن تحديث قاعدة البيانات
        الأخير (Migration 078) لم يُطبَّق بعد. راجع محرر SQL في Supabase وشغّل
        الملف <code className="font-mono bg-white px-1 rounded">078_dsb_vendor_receipts_and_schedule.sql</code>،
        ثم أعد تحميل الصفحة.
      </p>
      {error?.digest && (
        <p className="text-[11px] text-red-700 font-mono mb-3">
          Digest: {error.digest}
        </p>
      )}
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
