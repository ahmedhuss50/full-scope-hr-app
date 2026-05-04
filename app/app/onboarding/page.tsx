import { redirect } from 'next/navigation'

/** Legacy route — moved to /app/hr/onboarding under the multi-module suite. */
export default function LegacyOnboardingRedirect() {
  redirect('/app/hr/onboarding')
}
