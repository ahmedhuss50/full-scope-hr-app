'use client'
/**
 * Sign-out button for the Client Portal header. Calls supabase.auth.signOut()
 * client-side and then navigates back to /portal (the public landing).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/LocaleContext'

export function PortalSignOutButton() {
  const router = useRouter()
  const { t } = useLocale()
  const [loading, setLoading] = useState(false)

  const onClick = async () => {
    setLoading(true)
    try {
      const supabase = createSupabaseBrowser()
      await supabase.auth.signOut()
    } finally {
      router.push('/portal')
      router.refresh()
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-md hover:bg-slate-100 transition disabled:opacity-60"
    >
      {loading ? '…' : t('portal.nav.signout')}
    </button>
  )
}
