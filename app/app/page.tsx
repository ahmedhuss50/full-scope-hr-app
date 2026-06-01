import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Suite-shell landing.
 *
 * Temporarily collapsed to a direct redirect into the Disbursements module.
 * The previous app picker (HR + DMS + CRM + Disbursements tiles) is preserved
 * in git history — restore from there when re-enabling other modules.
 *
 * Auth gating: the disbursements landing page handles its own auth + role
 * checks, so we don't need to repeat them here. If the user isn't signed in,
 * the redirect target will bounce them to /login.
 */
export default function AppPickerPage() {
  redirect('/app/disbursements')
}
