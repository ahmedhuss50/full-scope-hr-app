'use client'

/**
 * BeneficiaryCapacityPicker — standardized صفة المستفيد dropdown.
 *
 * Renders a select with the 8 canonical values from the CPA workbook.
 * Existing free-text values are preserved: if the current value isn't
 * canonical, the picker opens in «أخرى» mode with a text input so no
 * data is lost. Owner can still type any value via that fallback.
 */
import { useState } from 'react'
import {
  BENEFICIARY_CAPACITY_OPTIONS,
  isCanonicalBeneficiaryCapacity,
} from '@/lib/dsb/beneficiary-capacity'

export function BeneficiaryCapacityPicker({
  value,
  onChange,
  disabled,
  className,
  freeTextClassName,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  /** Wrapper className. */
  className?: string
  /** Input className when in «أخرى» mode. */
  freeTextClassName?: string
}) {
  // «أخرى» when: user chose "أخرى" from dropdown, or existing value is
  // free-text (non-canonical). Track it separately from `value` so the
  // user can be in «أخرى» mode with an empty text field.
  const initialOther = value === 'أخرى' || (!!value && !isCanonicalBeneficiaryCapacity(value))
  const [otherMode, setOtherMode] = useState<boolean>(initialOther)
  // If we opened in "other" mode with a non-canonical existing value,
  // preserve it as the current free-text. Otherwise start blank.
  const initialFreeText = initialOther && value !== 'أخرى' ? value : ''
  const [freeText, setFreeText] = useState<string>(initialFreeText)

  function onSelectChange(next: string) {
    if (next === 'أخرى') {
      setOtherMode(true)
      onChange(freeText || '')
    } else {
      setOtherMode(false)
      onChange(next)
    }
  }

  function onFreeTextChange(next: string) {
    setFreeText(next)
    onChange(next)
  }

  const selectValue = otherMode
    ? 'أخرى'
    : isCanonicalBeneficiaryCapacity(value)
      ? value
      : ''

  const inp = className ??
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'
  const freeInp = freeTextClassName ?? inp

  return (
    <div className="space-y-1.5">
      <select
        className={inp}
        value={selectValue}
        onChange={(e) => onSelectChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">— اختر —</option>
        {BENEFICIARY_CAPACITY_OPTIONS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {otherMode && (
        <input
          type="text"
          className={freeInp}
          value={freeText}
          onChange={(e) => onFreeTextChange(e.target.value)}
          disabled={disabled}
          placeholder="اكتب الصفة (مثال: مقاول من الباطن)"
        />
      )}
    </div>
  )
}
