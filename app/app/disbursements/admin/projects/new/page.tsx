import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { NewProjectForm, type EmployeeOption } from './NewProjectForm'

export const dynamic = 'force-dynamic'

function suggestNextCode(existingCodes: string[]): string {
  // Look for codes like DSB-001, DSB-002 and pick the next number.
  let max = 0
  for (const c of existingCodes) {
    const m = /^DSB-(\d+)$/i.exec(c)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `DSB-${String(max + 1).padStart(3, '0')}`
}

export default async function NewProjectPage() {
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

  const dsbRole = (profile.dsb_role as string | null) ?? null
  if (!dsbRole || !['employee', 'supervisor', 'owner'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string

  // Suggest the next code.
  const { data: existing } = await svc
    .from('dsb_projects')
    .select('code')
    .eq('tenant_id', tenantId)
  const existingCodes = ((existing ?? []) as { code: string }[]).map((r) => r.code)
  const suggested = suggestNextCode(existingCodes)

  // List potential assigned employees (anyone in tenant tagged dsb_role='employee').
  const { data: empRows } = await svc
    .from('users')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .eq('dsb_role', 'employee')
    .order('full_name', { ascending: true })
  const employees: EmployeeOption[] = ((empRows ?? []) as { id: string; full_name: string | null }[])
    .map((r) => ({ id: r.id, full_name: r.full_name ?? '—' }))

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى الإدارة
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">مشروع جديد</h1>
        <p className="text-sm text-slate-600">أنشئ مشروعًا جديدًا واختر الموظف المسؤول عن طلبات صرفه.</p>
      </header>

      <NewProjectForm suggestedCode={suggested} employees={employees} />
    </div>
  )
}
