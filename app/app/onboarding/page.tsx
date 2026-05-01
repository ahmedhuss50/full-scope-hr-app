import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { strings, type Locale } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

function tServer(key: keyof typeof strings, locale: Locale) {
  return strings[key]?.[locale] ?? strings[key]?.en ?? key
}

export default async function OnboardingPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc.from('users').select('locale').eq('email', user.email!).maybeSingle()
  const locale = ((profile?.locale as Locale) ?? 'ar')

  return (
    <div className="space-y-6">
      <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
        {tServer('onboarding.title', locale)}
      </h1>
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
        <div className="text-4xl mb-3">📋</div>
        <p className="text-sm">{tServer('onboarding.empty', locale)}</p>
      </div>
    </div>
  )
}
