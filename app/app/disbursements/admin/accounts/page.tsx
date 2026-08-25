import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { Banknote } from 'lucide-react'
import { AccountsListEditor, type AccountRow, type ProjectOption } from './AccountsListEditor'

/**
 * Tenant-wide accounts list with inline edit.
 *
 * Lists every dsb_project_accounts row across all projects with their
 * current project + client context. Owner can:
 *   - Re-assign an account to a different project (and by extension, client)
 *   - Edit label, account number, bank, IBAN
 *   - Delete a row (cascades to ON DELETE SET NULL on any case's
 *     paid_from_account_id)
 */
export const dynamic = 'force-dynamic'

type AccountRowRaw = {
  id: string
  project_id: string
  label: string
  account_number: string | null
  bank_name: string | null
  iban: string | null
  account_role: 'general' | 'construction' | 'admin_marketing' | 'escrow' | null
  created_at: string
  project: { id: string; name_ar: string; developer_id: string | null } | { id: string; name_ar: string; developer_id: string | null }[] | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

export default async function AccountsListPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')
  if (profile.dsb_role !== 'owner') {
    redirect('/app/disbursements/admin')
  }

  const tenantId = profile.tenant_id as string

  const [accountsRes, projectsRes, devsRes] = await Promise.all([
    svc
      .from('dsb_project_accounts')
      .select(`id, project_id, label, account_number, bank_name, iban, account_role, created_at,
               project:dsb_projects!dsb_project_accounts_project_id_fkey(id, name_ar, developer_id)`)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    svc
      .from('dsb_projects')
      .select('id, name_ar, developer_id')
      .eq('tenant_id', tenantId)
      .order('name_ar', { ascending: true }),
    svc
      .from('dsb_developers')
      .select('id, company_name_ar')
      .eq('tenant_id', tenantId)
      .order('company_name_ar', { ascending: true }),
  ])

  const developerNameById = new Map<string, string>()
  for (const d of ((devsRes.data ?? []) as Array<{ id: string; company_name_ar: string }>)) {
    developerNameById.set(d.id, d.company_name_ar)
  }

  const accounts: AccountRow[] = ((accountsRes.data ?? []) as AccountRowRaw[]).map((r) => {
    const proj = single(r.project)
    const devName = proj?.developer_id ? developerNameById.get(proj.developer_id) ?? null : null
    return {
      id: r.id,
      projectId: r.project_id,
      projectNameAr: proj?.name_ar ?? '—',
      developerNameAr: devName,
      label: r.label,
      accountNumber: r.account_number,
      bankName: r.bank_name,
      iban: r.iban,
      accountRole: r.account_role,
      createdAt: r.created_at,
    }
  })

  const projectOptions: ProjectOption[] = ((projectsRes.data ?? []) as Array<{ id: string; name_ar: string; developer_id: string | null }>)
    .map((p) => ({
      id: p.id,
      name_ar: p.name_ar,
      developer_name_ar: p.developer_id ? developerNameById.get(p.developer_id) ?? null : null,
    }))

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى الإدارة
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Banknote className="w-4 h-4" aria-hidden="true" />
          إدارة حسابات الدفع
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
            جميع حسابات الدفع
          </h1>
          <span className="text-sm text-slate-400 font-mono">({accounts.length})</span>
        </div>
        <p className="text-sm text-slate-600 max-w-3xl">
          القائمة الكاملة لحسابات الدفع المعرّفة لجميع المشاريع. يمكنك تغيير
          المشروع التابع له الحساب أو تعديل بياناته أو حذفه. تغيير المشروع
          يُغيّر العميل تلقائيًا.
        </p>
      </header>

      <AccountsListEditor accounts={accounts} projects={projectOptions} />
    </div>
  )
}
