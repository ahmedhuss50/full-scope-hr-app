import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import {
  BarChart3,
  FileText,
  Users,
  FolderKanban,
  UserCog,
  Clock,
  Sparkles,
  DollarSign,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react'
import { fmtDate } from '@/lib/dsb/datetime'

export const dynamic = 'force-dynamic'

const STAGE_LABEL: Record<string, string> = {
  draft:                  'مسودة',
  with_employee:          'مع المراجع',
  with_supervisor:        'مع المشرف',
  with_owner:             'مع المدير',
  sent_back_to_developer: 'أُعيد إلى المطوّر',
  signed:                 'موقّعة',
  cancelled:              'ملغاة',
}

function fmtSar(amount: number | null | undefined): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount} ر.س`
  }
}

function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}ث`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}د`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}س ${minutes % 60}د`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}ي ${hours % 24}س`
  return `${days}ي`
}

function fmtPercent(num: number, denom: number): string {
  if (denom <= 0) return '—'
  const pct = (num / denom) * 100
  return `${pct.toFixed(1)}%`
}

type CaseStatus =
  | 'draft'
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'sent_back_to_developer'
  | 'signed'
  | 'cancelled'

type CaseRow = {
  id: string
  case_number: string
  amount_sar: number | null
  status: CaseStatus
  developer_id: string | null
  project_id: string | null
  submitted_at: string | null
  signed_at: string | null
  created_at: string
  project: { id: string; code: string; name_ar: string; assigned_employee_id: string | null }
    | { id: string; code: string; name_ar: string; assigned_employee_id: string | null }[]
    | null
}

function single<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function ReportsPage() {
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

  // Manager-only gate.
  if ((profile.dsb_role as string | null) !== 'owner') {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string

  // ===== Parallel fetches =====
  const [
    casesRes,
    devsRes,
    projectsRes,
    usersRes,
    auditRes,
    extractedRes,
    editedRes,
  ] = await Promise.all([
    svc
      .from('dsb_cases')
      .select(
        `id, case_number, amount_sar, status, developer_id, project_id, submitted_at, signed_at, created_at,
         project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar, assigned_employee_id)`,
      )
      .eq('tenant_id', tenantId)
      .limit(5000),
    svc
      .from('dsb_developers')
      .select('id, company_name_ar')
      .eq('tenant_id', tenantId),
    svc
      .from('dsb_projects')
      .select('id, code, name_ar, developer_id, assigned_employee_id')
      .eq('tenant_id', tenantId),
    svc
      .from('users')
      .select('id, full_name, dsb_role')
      .eq('tenant_id', tenantId)
      .in('dsb_role', ['employee', 'supervisor', 'owner']),
    // Status-transition events from the audit log — used to compute time at each stage.
    svc
      .from('dsb_audit_log')
      .select('case_id, event, from_status, to_status, actor_user_id, occurred_at')
      .eq('tenant_id', tenantId)
      .in('event', [
        'developer_uploaded',
        'employee_approved',
        'supervisor_approved',
        'signed',
        'signed_with_document',
        'signed_with_drawn_signature',
        'sent_back_to_developer',
        'manual_move',
        'document_replaced',
      ])
      .order('occurred_at', { ascending: true })
      .limit(10000),
    // For AI accuracy: number of cases that have had extraction run.
    svc
      .from('dsb_audit_log')
      .select('case_id', { count: 'exact', head: false })
      .eq('tenant_id', tenantId)
      .eq('event', 'ai_breakdown_complete'),
    // For AI accuracy: number of cases where a human edited extracted fields.
    svc
      .from('dsb_audit_log')
      .select('case_id', { count: 'exact', head: false })
      .eq('tenant_id', tenantId)
      .eq('event', 'extracted_fields_edited'),
  ])

  const cases = (casesRes.data ?? []) as CaseRow[]
  const developers = ((devsRes.data ?? []) as Array<{ id: string; company_name_ar: string }>)
  const projects = ((projectsRes.data ?? []) as Array<{ id: string; code: string; name_ar: string; developer_id: string | null; assigned_employee_id: string | null }>)
  const users = ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null; dsb_role: string }>)
  const audits = ((auditRes.data ?? []) as Array<{ case_id: string; event: string; from_status: string | null; to_status: string | null; actor_user_id: string | null; occurred_at: string }>)

  // ===== Top-level KPIs =====
  const totalCases = cases.length
  const activeCases = cases.filter((c) => ['with_employee', 'with_supervisor', 'with_owner'].includes(c.status)).length
  const signedCases = cases.filter((c) => c.status === 'signed').length
  const sentBackCases = cases.filter((c) => c.status === 'sent_back_to_developer').length
  const totalAmount = cases.reduce((sum, c) => sum + Number(c.amount_sar ?? 0), 0)

  // Cycle time: signed cases — submitted_at → signed_at
  const cycleTimes = cases
    .filter((c) => c.status === 'signed' && c.submitted_at && c.signed_at)
    .map((c) => new Date(c.signed_at!).getTime() - new Date(c.submitted_at!).getTime())
    .filter((ms) => ms >= 0)
  const avgCycleMs = cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null

  // AI accuracy.
  const extractedCaseIds = new Set(
    ((extractedRes.data ?? []) as Array<{ case_id: string }>).map((r) => r.case_id),
  )
  const editedCaseIds = new Set(
    ((editedRes.data ?? []) as Array<{ case_id: string }>).map((r) => r.case_id),
  )
  const totalExtracted = extractedCaseIds.size
  const totalEdited = editedCaseIds.size
  const aiUnedited = totalExtracted - totalEdited
  const aiAccuracy = totalExtracted > 0 ? aiUnedited / totalExtracted : null

  // ===== Per-client breakdown =====
  const developersById = new Map(developers.map((d) => [d.id, d.company_name_ar]))
  type ClientStat = {
    id: string
    name: string
    total: number
    active: number
    signed: number
    sentBack: number
    amount: number
    cycleTimes: number[]
  }
  const clientStats = new Map<string, ClientStat>()
  for (const c of cases) {
    if (!c.developer_id) continue
    const stat = clientStats.get(c.developer_id) ?? {
      id: c.developer_id,
      name: developersById.get(c.developer_id) ?? '—',
      total: 0,
      active: 0,
      signed: 0,
      sentBack: 0,
      amount: 0,
      cycleTimes: [] as number[],
    }
    stat.total += 1
    stat.amount += Number(c.amount_sar ?? 0)
    if (['with_employee', 'with_supervisor', 'with_owner'].includes(c.status)) stat.active += 1
    if (c.status === 'signed') {
      stat.signed += 1
      if (c.submitted_at && c.signed_at) {
        const dt = new Date(c.signed_at).getTime() - new Date(c.submitted_at).getTime()
        if (dt >= 0) stat.cycleTimes.push(dt)
      }
    }
    if (c.status === 'sent_back_to_developer') stat.sentBack += 1
    clientStats.set(c.developer_id, stat)
  }
  const clientRows = Array.from(clientStats.values())
    .map((s) => ({
      ...s,
      avgCycleMs: s.cycleTimes.length > 0 ? s.cycleTimes.reduce((a, b) => a + b, 0) / s.cycleTimes.length : null,
    }))
    .sort((a, b) => b.total - a.total)

  // ===== Per-project breakdown =====
  const projectsById = new Map(projects.map((p) => [p.id, p]))
  type ProjectStat = {
    id: string
    code: string
    name: string
    clientName: string
    total: number
    signed: number
    active: number
    amount: number
    cycleTimes: number[]
  }
  const projectStats = new Map<string, ProjectStat>()
  for (const c of cases) {
    if (!c.project_id) continue
    const proj = projectsById.get(c.project_id)
    if (!proj) continue
    const stat = projectStats.get(c.project_id) ?? {
      id: c.project_id,
      code: proj.code,
      name: proj.name_ar,
      clientName: proj.developer_id ? developersById.get(proj.developer_id) ?? '—' : '—',
      total: 0,
      signed: 0,
      active: 0,
      amount: 0,
      cycleTimes: [] as number[],
    }
    stat.total += 1
    stat.amount += Number(c.amount_sar ?? 0)
    if (['with_employee', 'with_supervisor', 'with_owner'].includes(c.status)) stat.active += 1
    if (c.status === 'signed') {
      stat.signed += 1
      if (c.submitted_at && c.signed_at) {
        const dt = new Date(c.signed_at).getTime() - new Date(c.submitted_at).getTime()
        if (dt >= 0) stat.cycleTimes.push(dt)
      }
    }
    projectStats.set(c.project_id, stat)
  }
  const projectRows = Array.from(projectStats.values())
    .map((s) => ({
      ...s,
      avgCycleMs: s.cycleTimes.length > 0 ? s.cycleTimes.reduce((a, b) => a + b, 0) / s.cycleTimes.length : null,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 50)

  // ===== Per-employee KPIs =====
  const usersById = new Map(users.map((u) => [u.id, u]))
  type EmpStat = {
    id: string
    name: string
    role: string
    handled: number       // assigned employee count from project
    approved: number      // they approved cases (employee_approved or supervisor_approved)
    signed: number        // they signed cases as owner
    sentBack: number      // they sent cases back
    actionTotalMs: number // sum of time-at-stage they were responsible for
    actionCount: number
  }
  const empStats = new Map<string, EmpStat>()
  // Initialize from user list so even employees with zero cases show up.
  for (const u of users) {
    empStats.set(u.id, {
      id: u.id,
      name: u.full_name ?? '—',
      role: u.dsb_role,
      handled: 0,
      approved: 0,
      signed: 0,
      sentBack: 0,
      actionTotalMs: 0,
      actionCount: 0,
    })
  }
  // Count assigned employee on projects.
  for (const c of cases) {
    const p = single(c.project)
    if (p?.assigned_employee_id) {
      const s = empStats.get(p.assigned_employee_id)
      if (s) s.handled += 1
    }
  }
  // Walk audit log: count actions by actor, and compute time between consecutive events on the same case.
  const lastEventByCase = new Map<string, { occurred_at: string; actor_user_id: string | null }>()
  for (const a of audits) {
    const prev = lastEventByCase.get(a.case_id)
    if (prev) {
      const dt = new Date(a.occurred_at).getTime() - new Date(prev.occurred_at).getTime()
      if (dt >= 0 && a.actor_user_id) {
        const s = empStats.get(a.actor_user_id)
        if (s) {
          s.actionTotalMs += dt
          s.actionCount += 1
        }
      }
    }
    lastEventByCase.set(a.case_id, { occurred_at: a.occurred_at, actor_user_id: a.actor_user_id })

    if (!a.actor_user_id) continue
    const s = empStats.get(a.actor_user_id)
    if (!s) continue
    if (a.event === 'employee_approved' || a.event === 'supervisor_approved') s.approved += 1
    if (a.event === 'signed' || a.event === 'signed_with_document' || a.event === 'signed_with_drawn_signature') s.signed += 1
    if (a.event === 'sent_back_to_developer') s.sentBack += 1
  }
  const empRows = Array.from(empStats.values())
    .map((s) => ({
      ...s,
      avgActionMs: s.actionCount > 0 ? s.actionTotalMs / s.actionCount : null,
    }))
    .filter((s) => s.handled + s.approved + s.signed + s.sentBack > 0)
    .sort((a, b) => b.signed + b.approved - (a.signed + a.approved))

  // ===== Step duration analysis (across the firm) =====
  type StepStat = { stage: string; totalMs: number; count: number }
  const stepStatsMap = new Map<string, StepStat>()
  // For each case, walk transitions and accumulate time per `from_status`.
  const eventsByCase = new Map<string, typeof audits>()
  for (const a of audits) {
    const arr = eventsByCase.get(a.case_id) ?? []
    arr.push(a)
    eventsByCase.set(a.case_id, arr)
  }
  for (const list of eventsByCase.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]
      const curr = list[i]
      const stage = prev?.to_status ?? prev?.from_status ?? null
      if (!stage) continue
      const dt = new Date(curr!.occurred_at).getTime() - new Date(prev!.occurred_at).getTime()
      if (dt < 0) continue
      const s = stepStatsMap.get(stage) ?? { stage, totalMs: 0, count: 0 }
      s.totalMs += dt
      s.count += 1
      stepStatsMap.set(stage, s)
    }
  }
  const stepRows = Array.from(stepStatsMap.values())
    .map((s) => ({
      ...s,
      avgMs: s.count > 0 ? s.totalMs / s.count : null,
    }))
    .sort((a, b) => (b.avgMs ?? 0) - (a.avgMs ?? 0))

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى صندوق الصرفيات
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <BarChart3 className="w-4 h-4" aria-hidden="true" />
          تقرير الأداء
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          تقرير ومؤشرات الأداء
        </h1>
        <p className="text-sm text-slate-600">
          نظرة شاملة على عدد المستندات، توزيعها، الوقت المستغرق في كل مرحلة، ودقة الذكاء الاصطناعي.
        </p>
      </header>

      {/* Top KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={FileText} label="إجمالي الطلبات" value={String(totalCases)} />
        <Kpi icon={TrendingUp} label="نشطة الآن" value={String(activeCases)} />
        <Kpi icon={CheckCircle2} label="موقّعة" value={String(signedCases)} />
        <Kpi icon={DollarSign} label="إجمالي المبالغ" value={fmtSar(totalAmount)} />
        <Kpi icon={Clock} label="متوسط زمن الدورة" value={fmtDuration(avgCycleMs)} />
        <Kpi
          icon={Sparkles}
          label="دقة الذكاء الاصطناعي"
          value={aiAccuracy != null ? `${(aiAccuracy * 100).toFixed(1)}%` : '—'}
          hint={`${aiUnedited} من ${totalExtracted}`}
        />
      </section>

      {/* Per-client */}
      <Card title="الأداء حسب العميل" icon={Users}>
        {clientRows.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={['العميل', 'الإجمالي', 'النشطة', 'الموقّعة', 'أُعيدت', 'متوسط الدورة', 'المبلغ']}
            rows={clientRows.map((r) => [
              r.name,
              String(r.total),
              String(r.active),
              String(r.signed),
              String(r.sentBack),
              fmtDuration(r.avgCycleMs),
              fmtSar(r.amount),
            ])}
          />
        )}
      </Card>

      {/* Per-project */}
      <Card title="الأداء حسب المشروع" icon={FolderKanban}>
        {projectRows.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={['المشروع', 'العميل', 'الإجمالي', 'النشطة', 'الموقّعة', 'متوسط الدورة', 'المبلغ']}
            rows={projectRows.map((r) => [
              `${r.code} — ${r.name}`,
              r.clientName,
              String(r.total),
              String(r.active),
              String(r.signed),
              fmtDuration(r.avgCycleMs),
              fmtSar(r.amount),
            ])}
          />
        )}
      </Card>

      {/* Per-employee */}
      <Card title="مؤشرات الموظفين" icon={UserCog}>
        {empRows.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={['الموظف', 'الدور', 'موكّلة إليه', 'اعتمد', 'وقّع', 'أعاد', 'متوسط وقت الاجراء']}
            rows={empRows.map((r) => [
              r.name,
              roleLabel(r.role),
              String(r.handled),
              String(r.approved),
              String(r.signed),
              String(r.sentBack),
              fmtDuration(r.avgActionMs),
            ])}
          />
        )}
      </Card>

      {/* Step durations */}
      <Card title="متوسط الوقت في كل مرحلة" icon={Clock}>
        {stepRows.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={['المرحلة', 'الحالات المرصودة', 'متوسط الوقت', 'إجمالي الوقت']}
            rows={stepRows.map((r) => [
              STAGE_LABEL[r.stage] ?? r.stage,
              String(r.count),
              fmtDuration(r.avgMs),
              fmtDuration(r.totalMs),
            ])}
          />
        )}
      </Card>

      {/* AI accuracy detail */}
      <Card title="دقة استخراج الذكاء الاصطناعي" icon={Sparkles}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <Stat label="حالات تم استخراجها" value={String(totalExtracted)} />
          <Stat label="حالات تم تعديلها يدويًا" value={String(totalEdited)} />
          <Stat
            label="نسبة الدقة"
            value={aiAccuracy != null ? `${(aiAccuracy * 100).toFixed(1)}%` : '—'}
            hint={aiAccuracy != null ? `${aiUnedited} غير معدّلة من ${totalExtracted}` : undefined}
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
          تُحسب الدقة كنسبة الحالات التي لم يحتج المراجع إلى تعديل بياناتها المستخرجة. كل تعديل بشري يدلّ على فرصة لتحسين النموذج أو الـPDF المُرسل.
        </p>
      </Card>

      {/* Report metadata */}
      <div className="text-[11px] text-slate-400 text-center">
        تم إنشاء هذا التقرير في {fmtDate(new Date().toISOString())} — البيانات شاملة لكل سجلات المكتب.
      </div>
    </div>
  )
}

function roleLabel(role: string): string {
  if (role === 'owner') return 'مدير'
  if (role === 'supervisor') return 'مشرف'
  if (role === 'employee') return 'مراجع'
  return role
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-slate-400" aria-hidden />
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      </div>
      <div className="text-xl font-black text-slate-900 leading-tight">{value}</div>
      {hint && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{hint}</div>}
    </div>
  )
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  children: React.ReactNode
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <Icon className="w-4 h-4 text-slate-500" aria-hidden />
        <h2 className="serif font-bold text-base text-slate-900">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 font-mono mt-0.5">{hint}</div>}
    </div>
  )
}

function Empty() {
  return <div className="text-sm text-slate-500 text-center py-6">لا توجد بيانات بعد.</div>
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs font-semibold text-slate-500 border-b border-slate-200 bg-slate-50">
            {head.map((h, i) => (
              <th key={i} className="text-start py-2 px-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40">
              {row.map((cell, ci) => (
                <td key={ci} className={`py-2 px-3 ${ci === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
