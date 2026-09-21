/**
 * /api/dsb-cpa-report — CPA quarterly report generator.
 *
 * Query params:
 *   project=<uuid> · year=<YYYY> · quarter=<1..4>
 *
 * MVP status: STUB. The actual xlsx generator (which opens the template,
 * fills every sheet from dsb_projects + dsb_cpa_reports + dsb_cases +
 * dsb_payments + dsb_project_units + dsb_unit_sales, preserves formulas,
 * and streams back the .xlsx) lands in the next iteration.
 *
 * For now this route validates access and returns 501 so the editor page
 * gets a clean error message instead of crashing on a missing endpoint.
 */
import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('project')
  const yearStr   = url.searchParams.get('year')
  const quarterStr = url.searchParams.get('quarter')
  if (!projectId || !yearStr || !quarterStr) {
    return NextResponse.json({ error: 'بيانات ناقصة (project / year / quarter).' }, { status: 400 })
  }
  const year = Number(yearStr)
  const quarter = Number(quarterStr)
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: 'السنة غير صالحة.' }, { status: 400 })
  }
  if (![1, 2, 3, 4].includes(quarter)) {
    return NextResponse.json({ error: 'الربع غير صالح.' }, { status: 400 })
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'غير مصرح.' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email).maybeSingle()
  if (!profile) return NextResponse.json({ error: 'حسابك غير مرتبط بمستأجر.' }, { status: 403 })
  if ((profile.dsb_role as string | null) !== 'owner') {
    return NextResponse.json({ error: 'هذا الإجراء متاح للمدير فقط.' }, { status: 403 })
  }

  const { data: proj } = await svc
    .from('dsb_projects').select('id, tenant_id').eq('id', projectId).maybeSingle()
  if (!proj || (proj as { tenant_id: string }).tenant_id !== (profile.tenant_id as string)) {
    return NextResponse.json({ error: 'المشروع غير موجود.' }, { status: 404 })
  }

  // TODO(next): open the template xlsx, fill in the sheets, return as
  // application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
  return NextResponse.json(
    { error: 'مولّد الملف قيد التطوير — استخدم زر «حفظ التقرير» في الوقت الحالي، وسنكمل توليد النموذج في التحديث القادم.' },
    { status: 501 },
  )
}
