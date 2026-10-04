'use client'

/**
 * BeneficiaryPicker — cascading type → specific-entity selector for the
 * اسم المستفيد field on the case page.
 *
 * UX:
 *   1. User picks a type: مشتري / مطور / مقاول / جهة حكومية / بنك / أخرى
 *   2. A second dropdown appears with options filtered to that type
 *   3. Picking an option calls onPick(name) which auto-fills the Arabic
 *      name field in the parent form. For 'أخرى' no second dropdown —
 *      user types directly in the parent text field.
 *
 * The picker is additive — it doesn't replace the Arabic text input;
 * it just gives staff a fast way to pick from known entities on the
 * project (buyers, vendors) rather than retyping. The text input
 * remains fully editable afterwards.
 */
import { useMemo, useState } from 'react'
import { Users, Building2, Hammer, Landmark, Building, PenLine } from 'lucide-react'

export type BeneficiaryType = 'buyer' | 'developer' | 'vendor' | 'gov' | 'bank' | 'other'

export type BeneficiaryOption = {
  type: BeneficiaryType
  id: string      // actual DB id when applicable; synthetic for gov/bank
  name_ar: string
  hint?: string   // e.g. contract number for buyer, category for vendor
}

export type BeneficiaryPickerProps = {
  buyers:    BeneficiaryOption[]
  developer: BeneficiaryOption | null
  vendors:   BeneficiaryOption[]
  disabled?: boolean
  onPick: (name_ar: string, type: BeneficiaryType, ref_id: string | null) => void
}

// Shipped lists for gov + banks (common in KSA real-estate escrow context).
const GOV_OPTIONS: BeneficiaryOption[] = [
  { type: 'gov', id: 'rega',       name_ar: 'الهيئة العامة للعقار (REGA)' },
  { type: 'gov', id: 'moh',        name_ar: 'وزارة الإسكان' },
  { type: 'gov', id: 'municipality', name_ar: 'البلدية' },
  { type: 'gov', id: 'zatca',      name_ar: 'هيئة الزكاة والضريبة والجمارك' },
  { type: 'gov', id: 'sdaia',      name_ar: 'الهيئة السعودية للبيانات والذكاء الاصطناعي' },
  { type: 'gov', id: 'other',      name_ar: 'جهة حكومية أخرى' },
]

const BANK_OPTIONS: BeneficiaryOption[] = [
  { type: 'bank', id: 'rajhi',   name_ar: 'مصرف الراجحي' },
  { type: 'bank', id: 'ahli',    name_ar: 'البنك الأهلي السعودي' },
  { type: 'bank', id: 'riyad',   name_ar: 'بنك الرياض' },
  { type: 'bank', id: 'samba',   name_ar: 'بنك سامبا (الأهلي)' },
  { type: 'bank', id: 'sab',     name_ar: 'البنك السعودي البريطاني (ساب)' },
  { type: 'bank', id: 'alinma',  name_ar: 'مصرف الإنماء' },
  { type: 'bank', id: 'bilad',   name_ar: 'بنك البلاد' },
  { type: 'bank', id: 'jazira',  name_ar: 'بنك الجزيرة' },
  { type: 'bank', id: 'anb',     name_ar: 'البنك العربي الوطني' },
  { type: 'bank', id: 'other',   name_ar: 'بنك آخر' },
]

const TYPE_META: Array<{ code: BeneficiaryType; label: string; icon: React.ElementType }> = [
  { code: 'buyer',     label: 'مشتري',       icon: Users },
  { code: 'developer', label: 'مطور',        icon: Building2 },
  { code: 'vendor',    label: 'مقاول / مورد', icon: Hammer },
  { code: 'gov',       label: 'جهة حكومية',  icon: Landmark },
  { code: 'bank',      label: 'بنك',         icon: Building },
  { code: 'other',     label: 'أخرى',        icon: PenLine },
]

export function BeneficiaryPicker({
  buyers,
  developer,
  vendors,
  disabled,
  onPick,
}: BeneficiaryPickerProps) {
  const [type, setType] = useState<BeneficiaryType | ''>('')
  const [sel,  setSel]  = useState<string>('')

  const options = useMemo<BeneficiaryOption[]>(() => {
    if (type === 'buyer')     return buyers
    if (type === 'developer') return developer ? [developer] : []
    if (type === 'vendor')    return vendors
    if (type === 'gov')       return GOV_OPTIONS
    if (type === 'bank')      return BANK_OPTIONS
    return []
  }, [type, buyers, developer, vendors])

  function pickType(t: BeneficiaryType | '') {
    setType(t); setSel('')
    // Auto-pick developer (only one option) immediately when type=developer
    if (t === 'developer' && developer) {
      onPick(developer.name_ar, 'developer', developer.id)
      setSel(developer.id)
    }
  }

  function pickOption(id: string) {
    setSel(id)
    const opt = options.find((o) => o.id === id)
    if (opt && type && type !== 'other') onPick(opt.name_ar, type, opt.type === 'gov' || opt.type === 'bank' ? null : opt.id)
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2" dir="rtl">
      <div className="text-[11px] font-bold text-indigo-900">اختر المستفيد من قائمة</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Type dropdown */}
        <select
          value={type}
          onChange={(e) => pickType(e.target.value as BeneficiaryType | '')}
          disabled={disabled}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">— نوع المستفيد —</option>
          {TYPE_META.map((t) => (
            <option key={t.code} value={t.code}>{t.label}</option>
          ))}
        </select>

        {/* Second dropdown (hidden for 'other' and 'developer' once auto-picked) */}
        {type && type !== 'other' && (
          <select
            value={sel}
            onChange={(e) => pickOption(e.target.value)}
            disabled={disabled || options.length === 0}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
          >
            <option value="">
              {options.length === 0 ? '— لا توجد خيارات —' : '— اختر —'}
            </option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name_ar}{o.hint ? ` · ${o.hint}` : ''}
              </option>
            ))}
          </select>
        )}
        {type === 'other' && (
          <div className="text-[11px] text-slate-600 self-center">
            اكتب اسم المستفيد يدوياً في الحقل أدناه
          </div>
        )}
      </div>
    </div>
  )
}
