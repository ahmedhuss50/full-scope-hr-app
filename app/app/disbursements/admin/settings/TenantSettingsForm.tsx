'use client'

/**
 * TenantSettingsForm — client component wrapping the tenant-level fields
 * that feed the REGA delivery notice + future accountant workbook.
 *
 * Owner-only. Single form, saves everything atomically. Recipient emails
 * are entered as a newline-separated textarea; the server splits and
 * dedupes.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, X } from 'lucide-react'
import { updateTenantSettings } from './actions'

export type TenantSettings = {
  accountant_office_name:        string | null
  accountant_office_license:     string | null
  accountant_signer_name:        string | null
  accountant_signer_title:       string | null
  accountant_signer_email:       string | null
  accountant_signer_phone:       string | null
  rega_default_recipient_emails: string[] | null
}

export function TenantSettingsForm({ initial }: { initial: TenantSettings }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okFlash, setOkFlash] = useState(false)

  const [officeName,    setOfficeName]    = useState(initial.accountant_office_name    ?? '')
  const [officeLicense, setOfficeLicense] = useState(initial.accountant_office_license ?? '')
  const [signerName,    setSignerName]    = useState(initial.accountant_signer_name    ?? '')
  const [signerTitle,   setSignerTitle]   = useState(initial.accountant_signer_title   ?? '')
  const [signerEmail,   setSignerEmail]   = useState(initial.accountant_signer_email   ?? '')
  const [signerPhone,   setSignerPhone]   = useState(initial.accountant_signer_phone   ?? '')
  const [recipientsRaw, setRecipientsRaw] = useState(
    (initial.rega_default_recipient_emails ?? []).join('\n'),
  )

  async function onSave() {
    setError(null); setOkFlash(false)
    setSaving(true)
    const res = await updateTenantSettings({
      accountant_office_name:      officeName.trim() || null,
      accountant_office_license:   officeLicense.trim() || null,
      accountant_signer_name:      signerName.trim() || null,
      accountant_signer_title:     signerTitle.trim() || null,
      accountant_signer_email:     signerEmail.trim() || null,
      accountant_signer_phone:     signerPhone.trim() || null,
      rega_default_recipients_raw: recipientsRaw,
    })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setOkFlash(true)
    startTransition(() => router.refresh())
    setTimeout(() => setOkFlash(false), 2500)
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
      <div>
        <h2 className="serif font-bold text-base text-slate-900">هوية المكتب المحاسبي</h2>
        <p className="text-xs text-slate-500 mt-1">
          هذه الحقول تظهر في كل مستند تُرسله إلى الهيئة العامة للعقار (اشعار تسليم التقرير الربعي، وتقرير المحاسب القانوني).
          املأها مرة واحدة ويستخدمها التوليد التلقائي لكل المشاريع.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم المكتب</label>
          <input
            className={inputCls}
            value={officeName}
            onChange={(e) => setOfficeName(e.target.value)}
            disabled={saving}
            placeholder="مثال: شركة إتقان للاستشارات المهنية"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم ترخيص المكتب</label>
          <input
            className={inputCls}
            value={officeLicense}
            onChange={(e) => setOfficeLicense(e.target.value)}
            disabled={saving}
            dir="ltr"
            placeholder="رقم ترخيص المحاسب القانوني"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">البريد الإلكتروني للمُوقِّع</label>
          <input
            className={inputCls}
            value={signerEmail}
            onChange={(e) => setSignerEmail(e.target.value)}
            disabled={saving}
            dir="ltr"
            type="email"
            placeholder="mahdi@example.com"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم جوال المُوقِّع</label>
          <input
            className={inputCls}
            value={signerPhone}
            onChange={(e) => setSignerPhone(e.target.value)}
            disabled={saving}
            dir="ltr"
            type="tel"
            placeholder="+9665XXXXXXXX"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم المُوقِّع المعتمَد</label>
          <input
            className={inputCls}
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            disabled={saving}
            placeholder="مثال: مهدي بوخمسين"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">المسمى الوظيفي للمُوقِّع</label>
          <input
            className={inputCls}
            value={signerTitle}
            onChange={(e) => setSignerTitle(e.target.value)}
            disabled={saving}
            placeholder="مثال: المدير التنفيذي"
          />
        </div>
      </div>

      <div className="pt-4 mt-2 border-t border-slate-100 space-y-2">
        <div>
          <h3 className="serif font-bold text-sm text-slate-900">مستلمو تقارير REGA</h3>
          <p className="text-xs text-slate-500 mt-1">
            قائمة البريد الإلكتروني الافتراضية التي تُدرَج في «وسيلة التسليم» على إشعار التسليم.
            كل بريد في سطر مستقل أو مفصولة بفاصلة.
          </p>
        </div>
        <textarea
          rows={3}
          className={inputCls + ' font-mono text-xs'}
          value={recipientsRaw}
          onChange={(e) => setRecipientsRaw(e.target.value)}
          disabled={saving}
          dir="ltr"
          placeholder={'h.albaqshi@fullscope.sa\nmahdi@etqan-cpa.sa'}
        />
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {okFlash && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          تم الحفظ.
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" aria-hidden="true" />
          {saving ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOfficeName(initial.accountant_office_name ?? '')
            setOfficeLicense(initial.accountant_office_license ?? '')
            setSignerName(initial.accountant_signer_name ?? '')
            setSignerTitle(initial.accountant_signer_title ?? '')
            setSignerEmail(initial.accountant_signer_email ?? '')
            setSignerPhone(initial.accountant_signer_phone ?? '')
            setRecipientsRaw((initial.rega_default_recipient_emails ?? []).join('\n'))
            setError(null)
          }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          استرجاع القيم الأصلية
        </button>
      </div>
    </section>
  )
}
