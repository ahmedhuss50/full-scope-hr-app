'use client'

import { Printer } from 'lucide-react'

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition print:hidden"
    >
      <Printer className="w-4 h-4" aria-hidden="true" />
      {label}
    </button>
  )
}
