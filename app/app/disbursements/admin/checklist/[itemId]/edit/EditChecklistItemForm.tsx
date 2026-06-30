'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateChecklistItem, deleteChecklistItem } from './actions'

type EditableItem = {
  id: string
  code: string
  prompt_ar: string
  prompt_en: string
  order_index: number
  active: boolean
  template_id: string | null
}

type TemplateOption = { id: string; label: string }

export function EditChecklistItemForm({
  item,
  templates,
}: {
  item: EditableItem
  templates: TemplateOption[]
}) {
  const router = useRouter()

  const [code, setCode] = useState(item.code)
  const [promptAr, setPromptAr] = useState(item.prompt_ar)
  const [promptEn, setPromptEn] = useState(item.prompt_en)
  const [orderIndex, setOrderIndex] = useState<number>(item.order_index)
  const [active, setActive] = useState(item.active)
  // Pre-select the item's current template; if it has none (legacy global
  // seed row), fall back to the first option so the picker is never empty.
  const [templateId, setTemplateId] = useState<string>(
    item.template_id ?? (templates[0]?.id ?? ''),
  )

  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const codeUpper = code.trim().toUpperCase()
    if (!codeUpper) { setError('الرمز مطلوب.'); return }
    if (!/^[A-Z][A-Z0-9_]*$/.test(codeUpper)) {
      setError('الرمز يجب أن يكون حروفًا كبيرة وأرقامًا وشرطات سفلية فقط.')
      return
    }
    if (!promptAr.trim()) { setError('النص بالعربية مطلوب.'); return }
    if (!promptEn.trim()) { setError('النص بالإنجليزية مطلوب.'); return }

    setSubmitting(true)
    try {
      // Only send template_id if there's at least one option AND it changed,
      // or if the item didn't have one before (legacy global). Otherwise omit
      // so the server leaves the existing assignment alone.
      const sendTemplate =
        templates.length > 0 &&
        (item.template_id == null || templateId !== item.template_id)
      const res = await updateChecklistItem({
        item_id: item.id,
        code: codeUpper,
        prompt_ar: promptAr.trim(),
        prompt_en: promptEn.trim(),
        order_index: Number.isFinite(orderIndex) ? orderIndex : 0,
        active,
        ...(sendTemplate ? { template_id: templateId } : {}),
      })
      if (!res.ok) {
        setError(res.error)
        setSubmitting(false)
        return
      }
      const dest = templateId
        ? `/app/disbursements/admin/checklist-templates/${templateId}`
        : '/app/disbursements/admin/checklist-templates'
      router.push(dest)
    } catch (err) {
      console.error('[EditChecklistItemForm] submit threw', err)
      setError(err instanceof Error ? err.message : 'تعذّر حفظ البند.')
      setSubmitting(false)
    }
  }

  async function onDelete() {
    setError(null)
    if (!window.confirm('هل أنت متأكد من حذف هذا البند؟')) return
    setDeleting(true)
    try {
      const res = await deleteChecklistItem({ item_id: item.id })
      if (!res.ok) {
        setError(res.error)
        setDeleting(false)
        return
      }
      const dest = item.template_id
        ? `/app/disbursements/admin/checklist-templates/${item.template_id}`
        : '/app/disbursements/admin/checklist-templates'
      router.push(dest)
    } catch (err) {
      console.error('[EditChecklistItemForm] delete threw', err)
      setError(err instanceof Error ? err.message : 'تعذّر حذف البند.')
      setDeleting(false)
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

      {templates.length > 0 && (
        <div>
          <label className={labelCls} htmlFor="template_id">القائمة *</label>
          <select
            id="template_id"
            className={inputCls}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            required
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">يمكن نقل البند إلى قائمة أخرى.</p>
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

      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || deleting}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
          >
            {submitting ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
          <a
            href="/app/disbursements/admin/checklist-templates"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            إلغاء
          </a>
        </div>
        <button
          type="button"
          disabled={submitting || deleting}
          onClick={onDelete}
          className="inline-flex items-center px-3 py-2 rounded-lg border border-red-200 bg-white text-red-700 text-sm font-semibold hover:bg-red-50 transition disabled:opacity-50"
        >
          {deleting ? 'جارٍ الحذف…' : 'حذف'}
        </button>
      </div>
    </form>
  )
}
