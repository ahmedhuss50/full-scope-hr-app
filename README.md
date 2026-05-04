# Full Scope — Multi-module suite (HR module shipped, CRM + Accounting in development)

> **Pivot note (2026-05):** "Full Scope HR" is now the **HR module** of a three-module suite called **Full Scope** (HR + CRM + Accounting). The HR module is feature-complete; CRM and Accounting are visible as preview pages at `/app/crm` and `/app/accounting`. App picker lives at `/app`; HR module home moved to `/app/hr`.

## Phase 1 scaffold (HR module)

Next.js 14 + Supabase (Postgres + Auth) + Tailwind + Resend.
Multi-tenant via row-level security. Bilingual AR / EN by design.
First tenant: **Full Scope** — a 12-staff accounting firm in Dammam, Saudi Arabia.

**What's in this scaffold (Phase 1 core loop):**

- Public candidate application at `/apply/[tenant]` — 3-step bilingual form, accounting-firm-aware (CPA/SOCPA tracks, license multi-select, jurisdictions, AR/EN fluency, practice area). Writes to `candidates` + `applications`.
- HR sign-in at `/login` — Supabase magic-link auth.
- HR dashboard at `/app` — candidate queue with status filters (CPA-track flag, licenses + practice area visible at a glance).
- Candidate detail at `/app/candidates/[id]` — profile + "Will interview" flow that proposes 3 time slots and emails the candidate via Resend.
- Candidate-facing slot picker at `/schedule/[token]` — bilingual (RTL when AR), confirms the slot, updates application status.
- Resend transactional email — `applicationReceived` (sent on submission) and `interviewProposed` (sent on Will-interview action), each rendered EN + AR.

**What's intentionally not included yet** (future sessions):

- Cal.com integration for real calendar availability (slots are HR-proposed for now)
- Twilio SMS / WhatsApp Business for reminders
- Documenso e-sign (offer letters, engagement letters)
- AI interview transcription (Deepgram / AssemblyAI) — Arabic + English mixed
- QBO / Xero / Sage sync
- Rate limiting, app-layer PII encryption (the schema relies on pgsodium from migrations)
- Automated tests, error boundaries, observability

---

## Prerequisites

- Node 18.17+
- A free Supabase project: [https://supabase.com/dashboard](https://supabase.com/dashboard)
- A Resend account: [https://resend.com](https://resend.com) (transactional email)
- (Later) Vercel account for deployment — Frankfurt (`fra1`) is pre-configured for GCC data residency.

---

## 1. Create the Supabase project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Pick a name (e.g. `full-scope-hr-dev`), set a strong DB password, choose a region in EU/EEA (e.g. Frankfurt) for GCC data-residency alignment.
3. Wait for it to provision (~2 min).
4. When done, open **Project Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## 2. Apply the database migrations

The migrations in `supabase/migrations/` are the 12 Full-Scope-HR-Platform schema files (tenants, candidates, interviews, GCC-specific compliance, payroll-sync stubs, RLS).

Fastest path — paste them into the Supabase SQL Editor:

1. In your Supabase project → **SQL Editor** → **New query**.
2. For each file in `supabase/migrations/` in order (001 → 012), paste its contents and click **Run**.
3. Then paste `supabase/seed.sql` and run it. This creates:
   - Tenant `Full Scope` (slug = `fullscope`, locale `ar`, currency `SAR`, VAT 15%, country `SA`)
   - 3 placeholder users: `hr@fullscope.sa`, `pm@fullscope.sa`, `partner@fullscope.sa` — replace these emails with the real Full Scope team's emails before production.
   - Practice areas: audit, tax, advisory, BD, consultation, admin
   - 3 sample job requisitions: Tax Accountant, Senior Auditor, Office Admin
   - 3 sample candidates (Saudi/Egyptian/Indian) in `applied`, `in_review`, `interview_scheduled`

Alternative — using the Supabase CLI:

```bash
brew install supabase/tap/supabase   # or see supabase.com/docs
supabase link --project-ref <your-ref>
supabase db push   # applies migrations/
psql $DATABASE_URL -f supabase/seed.sql
```

## 3. Create auth users (one-time, per seeded HR user)

Supabase Auth is separate from the `users` table. Invite each seeded user so they can sign in with magic link:

1. In Supabase → **Authentication → Users → Add user**.
2. Invite `hr@fullscope.sa` (or whichever email you swapped in for the HR Lead). Leave password blank; Supabase will email a magic link when they sign in.
3. Repeat for `pm@fullscope.sa` and `partner@fullscope.sa` (or your real-team emails).

> The app matches the Supabase auth user to the `users` row by **email**. If the emails don't match, you'll see a "No tenant mapping" page.

## 4. Set up Resend

1. Create an account at [https://resend.com](https://resend.com) and verify your sending domain (e.g. `fullscope.sa` or `mail.fullscope.sa`).
2. Add an API key → copy it into `RESEND_API_KEY`.
3. Set `RESEND_FROM` to a verified sender, e.g. `Full Scope <noreply@fullscope.sa>`.

> **Magic-link emails** are still sent through Supabase's default SMTP for Phase 1. To switch them to Resend SMTP, see SETUP.md.

## 5. Install and run

```bash
cp .env.example .env.local   # then fill in Supabase + Resend keys
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 6. Test the full Phase 1 loop

1. Go to `/apply/fullscope` (public, no auth). The page loads in Arabic by default. Toggle EN/AR; fill out the 3-step application; submit. The candidate should receive an `applicationReceived` email.
2. Go to `/login`. Enter `hr@fullscope.sa` (or your HR email). Click the magic link in your inbox.
3. You land on `/app` — the new candidate is in the queue at the top.
4. Click **View** on the candidate. You'll see their profile, licenses, jurisdictions, and a "Will interview" panel.
5. Pick an interviewer, adjust the 3 proposed slots, click **Propose interview**. The candidate receives an `interviewProposed` email in their preferred language.
6. The interview ID is shown in the interviews list — the schedule URL is `/schedule/<interview-id>`.
7. Open that URL in an incognito window (simulating the candidate). Pick a slot, click **Confirm**.
8. Refresh the HR dashboard — the candidate status is now `interview_scheduled`.

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import into [https://vercel.com/new](https://vercel.com/new).
3. Add all six env vars from `.env.example` in Vercel's project settings.
4. Set `NEXT_PUBLIC_SITE_URL` to your Vercel URL (e.g. `https://full-scope-hr.vercel.app`).
5. In Supabase → **Authentication → URL Configuration**, add your Vercel URL to **Site URL** and the callback `<vercel-url>/auth/callback` to **Redirect URLs**.
6. `vercel.json` already pins the function region to `fra1` (Frankfurt) per the C6 data-residency default for GCC clients.

---

## Project structure

```
full-scope-hr-app/
  app/
    apply/[tenant]/          # Public candidate application form (the intake)
      submitted/             # Thank-you page after submit
    schedule/[token]/        # Candidate-facing slot picker (no auth, tokenized)
      confirmed/             # Booking-confirmed page
    login/                   # Magic-link sign-in
    auth/callback/           # Supabase OAuth/magic-link callback
    app/                     # Authenticated HR area (layout enforces session)
      page.tsx               # Candidate queue / dashboard
      candidates/[id]/       # Candidate detail + will-interview flow
  components/                # UI components (forms, badges, language toggle)
  lib/
    supabase/                # Browser, server, middleware, service-role clients
    i18n/                    # Translation dictionary (EN/AR) + React context (with dir)
    tenant/                  # Tenant resolution by slug (public routes)
    email/                   # Resend wrapper + bilingual templates
      templates/
        applicationReceived.ts
        interviewProposed.ts
    types.ts                 # Domain types mirroring the A4 data model
  supabase/
    migrations/              # 12 SQL migrations from A4 (run once, in order)
    seed.sql                 # Full Scope tenant + sample data
  middleware.ts              # Refreshes Supabase session cookie
  tailwind.config.ts         # Full Scope HR brand: slate-900 ink + teal-600 accent
  tsconfig.json
  vercel.json                # region: fra1
```

---

## Known sharp edges

- **Service-role key on the server.** The service-role client bypasses RLS, so the service-role key must NEVER be exposed to the browser. All imports of `createSupabaseService()` happen in Server Components, Route Handlers, and Server Actions — never in files annotated `'use client'`.
- **Candidate-facing endpoints** (`/apply/[tenant]`, `/schedule/[token]`) use the service-role client because there is no logged-in user at that moment. Future: rate-limiting + Turnstile/hCaptcha.
- **Scheduling token is the raw interview UUID.** Good enough for demo, bad for public links in production. Future: signed, short-lived JWT stored in a `schedule_tokens` table with explicit expiration + single-use enforcement.
- **Tenant mapping by email.** When a user signs in with magic link, we look up their tenant by email in the `users` table. Future: stamp `tenant_id` on the JWT via a Supabase Auth hook so RLS picks it up natively (DEC-008 refinement).
- **No Cal.com integration yet.** HR manually types the 3 proposed slots. Block F2 in the master task list wires real calendar availability.
- **No SMS / WhatsApp yet.** Resend handles email. WhatsApp Business is a later block.
- **Magic-link emails still go through Supabase default SMTP.** See SETUP.md for swapping to Resend SMTP via the Supabase dashboard.
- **AR translations are best-effort professional Arabic.** Have a native Arabic copywriter review the `lib/i18n/translations.ts` strings + the AR email templates before launch.

---

## Master task list progress

The scaffold in this directory advances these task-list items:

- **D1–D3** (wireframe form + build + EN/AR translations) — shipped as a 3-step bilingual form
- **D7** (referral attribution) — source field present; dedicated referral UI deferred
- **D8** (W-2/1099 branch) — shipped as classification-preference toggle
- **D9** (CPA/SOCPA cert track + license multi-select) — shipped at intake
- **E1–E4** (dashboard wireframe, list, detail, will-interview button) — shipped
- **E5** (auth + RBAC) — auth shipped; RBAC beyond "is user in tenant" deferred
- **F3** (candidate slot picker) — shipped
- **F2, F4, F5, F6** (Cal.com availability, calendar invites, SMS/WhatsApp) — deferred
- **F7** (Resend transactional email) — shipped (`applicationReceived`, `interviewProposed`)
- **G1–G2** (status taxonomy, real-time display) — shipped, minus real-time subscriptions
- **G4** (audit log) — writing to `audit_log` on key events

Everything else (Phase 2 interview AI, Phase 3 docs/onboarding/payroll) is untouched by this scaffold.
