'use client'

/**
 * Thin per-entity wrappers around DeleteRowButton that bind each list row to
 * the right server action. Keeps page components (which are server-rendered)
 * from having to pass async function references across the client boundary.
 */
import { DeleteRowButton } from './DeleteRowButton'
import { deleteCase } from '../delete-actions'
import { deleteSale, deleteUnit } from '../units/actions'

export function DeleteCaseButton({ caseId, caseNumber }: { caseId: string; caseNumber: string | null }) {
  return (
    <DeleteRowButton
      onDelete={() => deleteCase({ case_id: caseId })}
      confirmMessage={`حذف الطلب ${caseNumber ?? caseId}؟ لا يمكن التراجع.`}
      title="حذف الطلب"
    />
  )
}

export function DeleteSaleButton({ saleId, label }: { saleId: string; label: string }) {
  return (
    <DeleteRowButton
      onDelete={() => deleteSale({ id: saleId })}
      confirmMessage={`حذف عقد «${label}»؟ لا يمكن التراجع.`}
      title="حذف العقد"
    />
  )
}

export function DeleteUnitButton({ unitId, unitNumber }: { unitId: string; unitNumber: string }) {
  return (
    <DeleteRowButton
      onDelete={() => deleteUnit({ id: unitId })}
      confirmMessage={`حذف الوحدة «${unitNumber}»؟ العقود المرتبطة قد تتأثر — راجع قبل الحذف.`}
      title="حذف الوحدة"
    />
  )
}
