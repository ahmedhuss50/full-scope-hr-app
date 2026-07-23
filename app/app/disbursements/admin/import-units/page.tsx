import { redirect } from 'next/navigation'

/**
 * Compatibility redirect — the master importer moved to
 * /admin/imports/master. Any bookmark, email link, or in-app link that
 * hasn't been updated yet lands here and gets sent along.
 */
export const dynamic = 'force-dynamic'

export default function LegacyImportUnitsPage() {
  redirect('/app/disbursements/admin/imports/master')
}
