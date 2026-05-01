'use client'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/LocaleContext'

export function SignOutButton() {
  const { t } = useLocale()
  const router = useRouter()
  const onClick = async () => {
    const supabase = createSupabaseBrowser()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
  return <button onClick={onClick} className="text-sm font-semibold text-ink/70 hover:text-ink">{t('nav.sign_out')}</button>
}
