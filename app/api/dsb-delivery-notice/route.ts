/**
 * GET /api/dsb-delivery-notice?project_id=<uuid>&quarter=Q2&year=2026
 * ----------------------------------------------------------------------------
 * Generates the REGA delivery notice («اشعار تسليم تقرير») for a project +
 * period, populated from live data, and streams it back as a .docx download.
 *
 * Auth: cookie session, owner only.
 *
 * Missing tenant/project fields (accountant office name, REGA license, etc.)
 * are surfaced as inline «لم يُعبَّأ» in the generated document rather than
 * failing the request — this way the owner still gets a preview and can tell
 * exactly which fields to fill in first.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import {
  generateDeliveryNoticeDocx,
  fmtGregorianArabic,
  quarterArabicFromMonth,
  type DeliveryNoticeVars,
} from '@/lib/dsb/generate-delivery-notice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_QUARTERS = new Set(['Q1', 'Q2', 'Q3', 'Q4'])
const MISSING_PLACEHOLDER = 'لم يُعبَّأ'

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if ((profile.dsb_role as string | null) !== 'owner') {
    return NextResponse.json({ error: 'owner_only' }, { status: 403 })
  }

  const tenantId = profile.tenant_id as string
  const projectId = (req.nextUrl.searchParams.get('project_id') ?? '').trim()
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const quarterRaw = (req.nextUrl.searchParams.get('quarter') ?? '').trim().toUpperCase()
  const now = new Date()
  const quarter = ALLOWED_QUARTERS.has(quarterRaw) ? quarterRaw : `Q${Math.ceil((now.getMonth() + 1) / 3)}`
  const year = (req.nextUrl.searchParams.get('year') ?? String(now.getFullYear())).trim()

  // ---- Load project + developer + tenant in parallel ----
  const [projRes, tenRes] = await Promise.all([
    svc
      .from('dsb_projects')
      .select('id, tenant_id, code, name_ar, developer_id, rega_license_no, rega_agreement_date_hijri, rega_agreement_date_gregorian')
      .eq('id', projectId)
      .maybeSingle(),
    svc
      .from('tenants')
      .select('id, name, accountant_office_name, accountant_signer_name, accountant_signer_title, accountant_signer_email, rega_default_recipient_emails')
      .eq('id', tenantId)
      .maybeSingle(),
  ])
  const project = projRes.data as {
    id: string
    tenant_id: string
    code: string
    name_ar: string
    developer_id: string | null
    rega_license_no: string | null
    rega_agreement_date_hijri: string | null
    rega_agreement_date_gregorian: string | null
  } | null
  if (!project || project.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let developerName: string | null = null
  if (project.developer_id) {
    const { data: dev } = await svc
      .from('dsb_developers')
      .select('company_name_ar')
      .eq('tenant_id', tenantId)
      .eq('id', project.developer_id)
      .maybeSingle()
    developerName = (dev?.company_name_ar as string | null) ?? null
  }

  const tenant = tenRes.data as {
    accountant_office_name: string | null
    accountant_signer_name: string | null
    accountant_signer_title: string | null
    accountant_signer_email: string | null
    rega_default_recipient_emails: string[] | null
  } | null

  // Quarter number → Arabic label.
  const quarterMonth = { Q1: 2, Q2: 5, Q3: 8, Q4: 11 }[quarter as 'Q1' | 'Q2' | 'Q3' | 'Q4'] ?? 5
  const quarterAr = quarterArabicFromMonth(quarterMonth + 1)

  // Recipient list: join tenant defaults with the office signer's email if present.
  const recipients = [
    ...(tenant?.rega_default_recipient_emails ?? []),
    ...(tenant?.accountant_signer_email ? [tenant.accountant_signer_email] : []),
  ]
  const recipientDisplay = recipients.length > 0
    ? recipients.map((e) => `(${e})`).join(' ')
    : MISSING_PLACEHOLDER

  const vars: DeliveryNoticeVars = {
    project_name:                 project.name_ar || MISSING_PLACEHOLDER,
    rega_license_no:              project.rega_license_no || MISSING_PLACEHOLDER,
    developer_name:               developerName || MISSING_PLACEHOLDER,
    accountant_office_name:       tenant?.accountant_office_name || MISSING_PLACEHOLDER,
    accountant_signer_name:       tenant?.accountant_signer_name || MISSING_PLACEHOLDER,
    accountant_signer_title:      tenant?.accountant_signer_title || MISSING_PLACEHOLDER,
    quarter_ar:                   quarterAr,
    year:                         year,
    delivery_date_hijri:          MISSING_PLACEHOLDER, // TODO — Hijri converter, deferred
    delivery_date_gregorian:      fmtGregorianArabic(now),
    rega_agreement_date_hijri:    project.rega_agreement_date_hijri || MISSING_PLACEHOLDER,
    rega_agreement_date_gregorian: project.rega_agreement_date_gregorian
      ? fmtGregorianArabic(new Date(project.rega_agreement_date_gregorian + 'T00:00:00'))
      : MISSING_PLACEHOLDER,
    recipient_emails:             recipientDisplay,
  }

  const bytes = await generateDeliveryNoticeDocx(vars)
  // Copy into a fresh ArrayBuffer — Node's Buffer's backing store is typed
  // as ArrayBufferLike (could be SharedArrayBuffer), which upsets the DOM
  // BlobPart type in TS. A plain ArrayBuffer sidesteps that.
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

  // Filename per the REGA convention on the delivery notice itself.
  const filename = `اشعار تسليم تقرير ${quarter} ${year} - ${project.name_ar}.docx`
  return new NextResponse(blob, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
