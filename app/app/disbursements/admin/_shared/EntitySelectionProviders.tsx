'use client'

/**
 * Entity-specific wrappers around SelectionProvider that pre-bind the
 * matching bulk-delete server action. Keeps server-rendered list pages free
 * of client-boundary action imports.
 */
import { SelectionProvider } from './SelectionContext'
import { bulkDeletePayments } from '../lists/payments/actions'
import { bulkDeleteSales, bulkDeleteUnits } from '../units/actions'

export function PaymentsSelectionProvider({
  allIds, children,
}: { allIds: string[]; children: React.ReactNode }) {
  return (
    <SelectionProvider
      allIds={allIds}
      entityLabel={{ noun: 'دفعة', many: 'دفعات' }}
      onDelete={(ids) => bulkDeletePayments({ payment_ids: ids })}
    >
      {children}
    </SelectionProvider>
  )
}

export function SalesSelectionProvider({
  allIds, children,
}: { allIds: string[]; children: React.ReactNode }) {
  return (
    <SelectionProvider
      allIds={allIds}
      entityLabel={{ noun: 'عقد', many: 'عقود' }}
      onDelete={(ids) => bulkDeleteSales({ ids })}
    >
      {children}
    </SelectionProvider>
  )
}

export function UnitsSelectionProvider({
  allIds, children,
}: { allIds: string[]; children: React.ReactNode }) {
  return (
    <SelectionProvider
      allIds={allIds}
      entityLabel={{ noun: 'وحدة', many: 'وحدات' }}
      onDelete={(ids) => bulkDeleteUnits({ ids })}
    >
      {children}
    </SelectionProvider>
  )
}
