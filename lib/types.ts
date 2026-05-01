// Minimal domain types mirroring the A4 Full Scope HR data model. Not a full generated
// supabase type file — add `supabase gen types typescript` in a future session.

export type Classification = 'W-2' | '1099'
export type ApplicationStatus =
  | 'applied' | 'in_review' | 'interview_pending' | 'interview_scheduled'
  | 'interview_completed' | 'decision_pending' | 'offer_extended'
  | 'offer_accepted' | 'hired' | 'rejected' | 'withdrawn'

// GCC-aware work-auth taxonomy (replaces Innuvis US-specific values).
export type WorkAuth =
  | 'GCC National'
  | 'GCC Resident'
  | 'Permanent Resident'
  | 'Work Visa Sponsored'
  | 'Citizen of Hiring Country'
  | 'Requires Sponsorship'

// Application sources reflecting GCC accounting hiring channels.
export type ApplicationSource =
  | 'walk_in' | 'referral' | 'linkedin' | 'indeed' | 'bayt'
  | 'naukrigulf' | 'website' | 'whatsapp' | 'other'

// Locale: AR primary for Full Scope HR / Full Scope, EN secondary.
export type Locale = 'en' | 'ar'

// Languages spoken — used for AR/EN fluency dropdowns on candidate intake.
export type FluencyLevel = 'native' | 'fluent' | 'conversational' | 'basic' | 'none'

// Practice areas for an accounting + BD firm.
export type PracticeAreaCode = 'audit' | 'tax' | 'advisory' | 'bd' | 'admin'

// Standard professional licenses recognised in KSA / GCC accounting practice.
export type LicenseCode =
  | 'CPA' | 'CFA' | 'EA' | 'SOCPA' | 'ZATCA' | 'IFRS' | 'ACCA' | 'CIA' | 'CMA'

// Jurisdictions a candidate may have practiced in.
export type JurisdictionCode = 'KSA' | 'UAE' | 'GCC' | 'US' | 'EU' | 'UK' | 'Other'

export interface Tenant {
  id: string
  name: string
  slug: string
  subdomain: string
  locale_default: Locale
  active: boolean
}

export interface JobRequisition {
  id: string
  title: string
  classification: Classification
  pay_type: string | null
  pay_rate_min: number | null
  pay_rate_max: number | null
  pay_currency: string | null
  openings_count: number
}

export interface Candidate {
  id: string
  tenant_id: string
  legal_first_name: string
  legal_last_name: string
  preferred_name: string | null
  primary_email: string | null
  mobile_phone: string | null
  home_country_code: string | null
  home_city: string | null
  home_postal_code: string | null
  work_auth_status: WorkAuth | null
  classification_preference: Classification | null
  source: ApplicationSource | null
  locale: Locale

  // Full Scope HR accounting-firm specific fields (matches A4 candidates schema).
  cpa_track: boolean
  licenses_held: LicenseCode[] | null
  jurisdictions: JurisdictionCode[] | null
  years_experience: number | null
  audit_hours: number | null
  primary_practice_area: PracticeAreaCode | null
  arabic_fluency: FluencyLevel | null
  english_fluency: FluencyLevel | null

  created_at: string
}

export interface Application {
  id: string
  tenant_id: string
  candidate_id: string
  job_requisition_id: string | null
  status: ApplicationStatus
  applied_at: string
  answers: Record<string, unknown>
}

export interface Interview {
  id: string
  tenant_id: string
  application_id: string
  scheduled_start: string | null
  scheduled_end: string | null
  status: 'slots_proposed' | 'scheduled' | 'completed' | 'no_show' | 'cancelled'
}
