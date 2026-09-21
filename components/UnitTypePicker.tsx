'use client'

/**
 * UnitTypePicker — standardized نوع الوحدة dropdown for the CPA workbook.
 * Renders a select with the 14 canonical values; existing free-text values
 * are preserved via «أخرى» mode with a text input fallback.
 */
import { useState } from 'react'
import { UNIT_TYPE_OPTIONS, isCanonicalUnitType } from '@/lib/dsb/unit-type'

export function UnitTypePicker({
  value,
  onChange,
  disabled,
  className,
  freeTextClassName,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  className?: string
  freeTextClassName?: string
}) {
  const initialOther = value === 'أخرى' || (!!value && !isCanonicalUnitType(value))
  const [otherMode, setOtherMode] = useState<boolean>(initialOther)
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
    : isCanonicalUnitType(value)
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
        {UNIT_TYPE_OPTIONS.map((o) => (
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
          placeholder="اكتب نوع الوحدة"
        />
      )}
    </div>
  )
}
