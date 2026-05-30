/**
 * ProcessDiagram — top-of-page horizontal flow diagram for a disbursement case.
 *
 * Server component. Renders four steps (Developer Upload → Employee Review →
 * Supervisor Review → Final Signature) with status icons, connectors, and
 * a small legend underneath.
 *
 * Visual treatment mirrors /app/dms/workflows/[id]/ProcessDiagram.tsx
 * (white card, slate borders, teal accents, serif headers).
 */
import { Fragment } from 'react'
import { ChevronLeft, Check, X, Circle, User } from 'lucide-react'

type CaseStatus =
  | 'draft'
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'sent_back_to_developer'
  | 'signed'
  | 'cancelled'

type StepState = 'done' | 'current' | 'pending' | 'sent_back'

interface Step {
  order: number
  name_ar: string
  handler: string
  state: StepState
}

function buildSteps(
  status: CaseStatus,
  developerName: string,
  assignedEmployeeName: string,
): Step[] {
  const base: Omit<Step, 'state'>[] = [
    { order: 1, name_ar: 'رفع المطور',          handler: developerName },
    { order: 2, name_ar: 'مراجعة الموظف',        handler: assignedEmployeeName },
    { order: 3, name_ar: 'مراجعة السوبرفايزر',   handler: 'السوبرفايزر' },
    { order: 4, name_ar: 'التوقيع النهائي',      handler: 'المدير' },
  ]

  function withStates(states: StepState[]): Step[] {
    return base.map((b, i) => ({ ...b, state: states[i] ?? 'pending' }))
  }

  switch (status) {
    case 'draft':
      return withStates(['pending', 'pending', 'pending', 'pending'])
    case 'sent_back_to_developer':
      return withStates(['sent_back', 'pending', 'pending', 'pending'])
    case 'with_employee':
      return withStates(['done', 'current', 'pending', 'pending'])
    case 'with_supervisor':
      return withStates(['done', 'done', 'current', 'pending'])
    case 'with_owner':
      return withStates(['done', 'done', 'done', 'current'])
    case 'signed':
      return withStates(['done', 'done', 'done', 'done'])
    case 'cancelled':
      // Show the path frozen — first step done, rest pending.
      return withStates(['done', 'pending', 'pending', 'pending'])
    default:
      return withStates(['pending', 'pending', 'pending', 'pending'])
  }
}

interface VisualTokens {
  card: string
  numberCircle: string
  iconWrap: string
  icon: React.ReactNode
  statusText: string
  statusLabel: string
}

function tokensFor(state: StepState): VisualTokens {
  if (state === 'done') {
    return {
      card: 'bg-green-50 border-green-200',
      numberCircle: 'bg-green-100 text-green-800 ring-2 ring-white',
      iconWrap: 'bg-green-100 text-green-700',
      icon: <Check className="w-3.5 h-3.5" aria-hidden="true" />,
      statusText: 'text-green-700',
      statusLabel: 'مكتمل',
    }
  }
  if (state === 'current') {
    return {
      card: 'bg-teal-50 border-teal-200 ring-2 ring-teal-100',
      numberCircle: 'bg-teal-600 text-white ring-2 ring-white',
      iconWrap: 'bg-teal-100 text-teal-700',
      icon: <span className="block w-2 h-2 rounded-full bg-teal-600 animate-pulse" aria-hidden="true" />,
      statusText: 'text-teal-700',
      statusLabel: 'الحالي',
    }
  }
  if (state === 'sent_back') {
    return {
      card: 'bg-red-50 border-red-200',
      numberCircle: 'bg-red-100 text-red-800 ring-2 ring-white',
      iconWrap: 'bg-red-100 text-red-700',
      icon: <X className="w-3.5 h-3.5" aria-hidden="true" />,
      statusText: 'text-red-700',
      statusLabel: 'أعيدت',
    }
  }
  // pending
  return {
    card: 'bg-slate-50 border-slate-200',
    numberCircle: 'bg-slate-200 text-slate-600 ring-2 ring-white',
    iconWrap: 'bg-slate-100 text-slate-500',
    icon: <Circle className="w-3.5 h-3.5" aria-hidden="true" />,
    statusText: 'text-slate-500',
    statusLabel: 'قيد الانتظار',
  }
}

export interface ProcessDiagramProps {
  status: CaseStatus
  developerName: string
  assignedEmployeeName: string
}

export function ProcessDiagram({
  status,
  developerName,
  assignedEmployeeName,
}: ProcessDiagramProps) {
  const steps = buildSteps(status, developerName, assignedEmployeeName)

  return (
    <section
      className="bg-white border border-slate-200 rounded-xl shadow-sm p-5"
      aria-label="مسار طلب الصرف"
    >
      <div className="grid grid-cols-2 sm:flex sm:flex-row sm:flex-nowrap items-stretch gap-3 sm:gap-2">
        {steps.map((step, idx) => {
          const tokens = tokensFor(step.state)
          const isLast = idx === steps.length - 1
          return (
            <Fragment key={step.order}>
              <div
                className={`flex-1 min-w-0 rounded-xl border p-3 sm:p-4 transition ${tokens.card}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shadow-sm ${tokens.numberCircle}`}
                    aria-hidden="true"
                  >
                    {step.order}
                  </span>
                  <div
                    className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full ${tokens.iconWrap}`}
                  >
                    {tokens.icon}
                  </div>
                </div>
                <div className="mt-2 text-sm font-bold text-slate-900 leading-tight truncate">
                  {step.name_ar}
                </div>
                <div className={`mt-0.5 text-[11px] font-semibold uppercase tracking-wider ${tokens.statusText}`}>
                  {tokens.statusLabel}
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-700 min-w-0">
                  <User className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                  <span className="truncate" title={step.handler}>
                    <span className="text-slate-500">بإدارة: </span>
                    {step.handler}
                  </span>
                </div>
              </div>
              {/* Connector — desktop only, between cards */}
              {!isLast && (
                <div
                  className="hidden sm:flex items-center justify-center text-slate-300 shrink-0"
                  aria-hidden="true"
                >
                  {/* RTL: arrow points left (the flow goes right-to-left visually) */}
                  <ChevronLeft className="w-5 h-5" />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <LegendDot cls="bg-green-500" label="مكتمل" />
        <LegendDot cls="bg-teal-600" label="الحالي" />
        <LegendDot cls="bg-slate-300" label="قيد الانتظار" />
        <LegendDot cls="bg-red-500"  label="أعيدت" />
      </div>
    </section>
  )
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${cls}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
