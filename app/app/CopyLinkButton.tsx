'use client'
import { useState } from 'react'

export function CopyLinkButton({ href }: { href: string }) {
  const [copied, setCopied] = useState(false)
  const fullUrl = typeof window !== 'undefined' ? `${window.location.origin}${href}` : href
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <button onClick={onClick} className="btn-ghost text-xs">
      <span className="font-mono mx-2 text-ink/50">{href}</span>
      {copied ? '✓ copied' : 'Copy link'}
    </button>
  )
}
