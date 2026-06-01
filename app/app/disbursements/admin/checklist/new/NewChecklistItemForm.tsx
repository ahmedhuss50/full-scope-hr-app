'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createChecklistItem } from './actions'

export function NewChecklistItemForm({ defaultOrderIndex }: { defaultOrderIndex: number }) {
  const router = useRouter()

  const [code, setCode] = useState('')
  const [promptAr, setPromptAr] = useState('')
  const [promptEn, setPromptEn] = useState('')
  const [orderIndex, setOrderIndex] = useState<number>(defaultOrderIndex)
  const [active, setActive] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const codeUpper = code.trim().toUpperCase()
    if (!codeUpper) {
      setError('الرمز مطلوب.')
      return
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(codeUpper)) {
      setError('الرمز يجب أن يكون حروفًا كبيرة وأرقامًا وشرطات سفلية فقط.')
      return
    }
    if (!promptAr.trim()) {
      setError('النص بالعربية مطلوب.')
      return
    }
    if (!promptEn.trim()) {
      setError('النص بالإنجليزية مطلوب.')
      return
    }

    setSubmitting(true)
    try {
      const res = await createChecklistItem({
        code: codeUpper,
        prompt_ar: promptAr.trim(),
        prompt_en: promptEn.trim(),
        order_index: Number.isFinite(orderIndex) ? orderIndex : 0,
        active,
      })
      if (!res.ok) {
        setError(res.error)
        setSubmitting(false)
        return
      }
      router.push('/app/disbursements/admin/checklist')
    } catch (err) {
      console.error('[NewChecklistItemForm] submit threw', err)
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء البند.')
      setSubmitting(false)
    }
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <form onSubmit={onSubmit} className="space-y-5 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="code">الرمز *</label>
        <input
          id="code"
          required
          dir="ltr"
          className={inputCls + ' text-left font-mono'}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={64}
          placeholder="MY_CUSTOM_ITEM"
        />
        <p className="text-[11px] text-slate-500 mt-1">حروف كبيرة وأرقام وشرطات سفلية فقط.</p>
      </div>

      <div>
        <label className={labelCls} htmlFor="prompt_ar">النص بالعربية *</label>
        <textarea
          id="prompt_ar"
          required
          rows={2}
          className={inputCls}
          value={promptAr}
          onChange={(e) => setPromptAr(e.target.value)}
          maxLength={500}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="prompt_en">النص بالإنجليزية *</label>
        <textarea
          id="prompt_en"
          required
          rows={2}
          dir="ltr"
          className={inputCls + ' text-left'}
          value={promptEn}
          onChange={(e) => setPromptEn(e.target.value)}
          maxLength={500}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="order_index">الترتيب</label>
          <input
            id="order_index"
            type="number"
            min={0}
            className={inputCls}
            value={Number.isFinite(orderIndex) ? orderIndex : 0}
            onChange={(e) => setOrderIndex(Number(e.target.value))}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer self-end pb-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-sm text-slate-700">نشط</span>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitting ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <a
          href="/app/disbursements/admin/checklist"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          إلغاء
        </a>
      </div>
    </form>
  )
}
