/**
 * GET /api/dsb-accountant-workbook-xlsx?project_id=<uuid>&quarter=Q2&year=2026
 * Streams the REGA accountant 7-sheet workbook .xlsx for a project +
 * quarter (owner-only).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { generateAccountantWorkbookXlsx } from '@/lib/dsb/generate-rega-xlsx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ALLOWED_QUARTERS = new Set(['Q1', 'Q2', 'Q3', 'Q4'])

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if ((profile.dsb_role as string | null) !== 'owner') {
    return NextResponse.json({ error: 'owner_only' }, { status: 403 })
  }

  const projectId = (req.nextUrl.searchParams.get('project_id') ?? '').trim()
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const now = new Date()
  const qRaw = (req.nextUrl.searchParams.get('quarter') ?? '').trim().toUpperCase()
  const quarter = (ALLOWED_QUARTERS.has(qRaw) ? qRaw : `Q${Math.ceil((now.getMonth() + 1) / 3)}`) as 'Q1' | 'Q2' | 'Q3' | 'Q4'
  const yearNum = Number(req.nextUrl.searchParams.get('year') ?? String(now.getFullYear())) || now.getFullYear()

  const { data: proj } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, name_ar')
    .eq('id', projectId)
    .maybeSingle()
  if (!proj || (proj as { tenant_id: string }).tenant_id !== (profile.tenant_id as string)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const bytes = await generateAccountantWorkbookXlsx(projectId, quarter, yearNum)
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const filename = `نموذج المحاسب القانوني ${quarter} ${yearNum} - ${(proj as { name_ar: string }).name_ar}.xlsx`
  return new NextResponse(blob, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
