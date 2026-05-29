import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { SignOutButton } from '@/app/app/SignOutButton'
import { FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Developer-portal layout — completely separate shell from /app.
 *
 * Auth gate:
 *   - user must be signed in
 *   - user.dsb_role must be 'developer'
 *
 * Sidebar is intentionally minimal: just "صرفياتي" + sign-out. Developers
 * see exactly one module.
 */
export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, full_name, dsb_role, locale')
    .eq('email', user.email!)
    .maybeSingle()

  if (!profile || profile.dsb_role !== 'developer') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50" dir="rtl">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-lg text-center shadow-sm">
          <h1 className="serif font-bold text-2xl mb-2">لا تملك صلاحية الوصول</h1>
          <p className="text-sm text-slate-600 mb-4">
            حسابك <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">{user.email}</code> غير مرتبط بحساب مطوّر.
          </p>
        </div>
      </main>
    )
  }

  return (
    <LocaleProvider initial="ar">
      <div className="app-shell flex min-h-screen" dir="rtl">
        <aside className="w-64 shrink-0 min-h-screen bg-white border-e border-slate-200 flex flex-col">
          <div className="px-5 py-5 border-b border-slate-200">
            <Link href="/developer" className="flex items-center gap-2 group">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-900 text-white font-black text-sm">F</span>
              <span className="font-bold text-slate-900 group-hover:text-slate-700">فُل سكوب</span>
            </Link>
            <div className="mt-3">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200">
                بوابة المطوّر
              </span>
            </div>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1">
            <Link
              href="/developer"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileText className="w-5 h-5 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="flex-1 truncate">صرفياتي</span>
            </Link>
          </nav>

          <div className="px-4 py-4 border-t border-slate-200">
            <div className="mb-3 min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">
                {(profile.full_name as string | null) ?? '—'}
              </div>
              <div className="text-xs text-slate-500 truncate">{user.email ?? ''}</div>
            </div>
            <SignOutButton />
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1 p-6 min-w-0">{children}</main>
        </div>
      </div>
    </LocaleProvider>
  )
}
