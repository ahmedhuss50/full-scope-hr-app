'use client'

import { DangerDeleteButton } from './DangerDeleteButton'
import {
  deleteCase,
  deleteProject,
  deleteClient,
  deleteEmployee,
} from './delete-actions'

/**
 * Per-entity wrappers around DangerDeleteButton that bind each button to its
 * specific server action. Keep all of these in one file so admin pages
 * import a single module.
 */

export function DeleteCaseButton({ caseId, caseNumber, size = 'md' }: {
  caseId: string
  caseNumber: string
  size?: 'sm' | 'md'
}) {
  return (
    <DangerDeleteButton
      action={() => deleteCase({ case_id: caseId })}
      label={`حذف ${caseNumber}`}
      confirmText="سيتم حذف هذا الطلب وجميع ملفاته وبنود التقسيم وقائمة المراجعة وسجل الأحداث نهائيًا. هل أنت متأكد؟"
      size={size}
      redirectTo="/app/disbursements"
    />
  )
}

export function DeleteProjectButton({ projectId, projectCode, size = 'md' }: {
  projectId: string
  projectCode: string
  size?: 'sm' | 'md'
}) {
  return (
    <DangerDeleteButton
      action={() => deleteProject({ project_id: projectId })}
      label={`حذف المشروع ${projectCode}`}
      confirmText="سيتم حذف هذا المشروع وكل الطلبات المرتبطة به (بكل ملفاتها وسجلاتها) نهائيًا. هل أنت متأكد؟"
      size={size}
      redirectTo="/app/disbursements/admin"
    />
  )
}

export function DeleteClientButton({ clientId, clientName, size = 'md' }: {
  clientId: string
  clientName: string
  size?: 'sm' | 'md'
}) {
  return (
    <DangerDeleteButton
      action={() => deleteClient({ client_id: clientId })}
      label={`حذف ${clientName}`}
      confirmText="سيتم حذف هذا العميل وكل مشاريعه وطلباته (بكل ملفاتها وسجلاتها) نهائيًا. هل أنت متأكد؟"
      size={size}
      redirectTo="/app/disbursements/admin"
    />
  )
}

export function DeleteEmployeeButton({ userId, fullName, size = 'sm' }: {
  userId: string
  fullName: string
  size?: 'sm' | 'md'
}) {
  return (
    <DangerDeleteButton
      action={() => deleteEmployee({ user_id: userId })}
      label="حذف"
      confirmText={`سيتم إزالة ${fullName} من النظام. حسابه في تسجيل الدخول لن يُحذف، لكنه لن يستطيع الوصول إلى مراجعة المستندات. المشاريع المخصصة له ستُترك بدون مسؤول. هل أنت متأكد؟`}
      size={size}
    />
  )
}
