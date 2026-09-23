/**
 * /api/dsb-cpa-report — CPA quarterly report generator.
 *
 * Query params:
 *   project=<uuid> · year=<YYYY> · quarter=<1..4>
 *
 * Owner-only. Loads the CPA template + fills sheets 1, 2, 4 (project data,
 * vouchers, unit-type breakdown). Sheets 3/5/6/7 are filled from the
 * dsb_cpa_reports record (opening balance, forecast, notes) — the pieces
 * we can't derive automatically.
 */
import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { generateAccountantWorkbookXlsx } from '@/lib/dsb/generate-rega-xlsx'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

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
  const quarterKey = (`Q${quarter}` as 'Q1' | 'Q2' | 'Q3' | 'Q4')

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
    .from('dsb_projects').select('id, tenant_id, name_ar').eq('id', projectId).maybeSingle()
  if (!proj || (proj as { tenant_id: string }).tenant_id !== (profile.tenant_id as string)) {
    return NextResponse.json({ error: 'المشروع غير موجود.' }, { status: 404 })
  }
  const projectName = (proj as { name_ar: string }).name_ar || 'project'

  const letterheadParam = url.searchParams.get('letterhead')
  const includeLetterhead = letterheadParam !== '0' && letterheadParam !== 'false'
  try {
    const buf = await generateAccountantWorkbookXlsx(projectId, quarterKey, year, { includeLetterhead })

    // Stamp generation timestamp on the report record (best-effort; ignore
    // errors so we don't block the download).
    try {
      await svc
        .from('dsb_cpa_reports')
        .update({ generated_at: new Date().toISOString(), generated_by_user_id: profile.id as string })
        .eq('tenant_id', profile.tenant_id as string)
        .eq('project_id', projectId)
        .eq('period_year', year)
        .eq('period_quarter', quarter)
    } catch { /* fall through */ }

    // Return the .xlsx. Filename is Arabic-safe via RFC 5987 encoding.
    const fname = `نموذج المحاسب — ${projectName} — Q${quarter} ${year}.xlsx`
    const encoded = encodeURIComponent(fname)
    // Copy into a fresh ArrayBuffer to satisfy the BodyInit type checker.
    const ab = new ArrayBuffer(buf.byteLength)
    new Uint8Array(ab).set(new Uint8Array(buf))
    return new Response(new Blob([ab]), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل توليد الملف.'
    // eslint-disable-next-line no-console
    console.error('[dsb-cpa-report] generation failed', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
