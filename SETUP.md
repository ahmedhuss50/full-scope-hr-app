# Full Scope HR — operational setup notes

Companion to `README.md`. Covers swap-out steps that are not part of the
day-1 walkthrough (custom magic-link sender, replacing placeholder users,
verifying the Resend domain, Vercel region pinning).

## Swapping Supabase magic-link emails to Resend SMTP

By default Supabase sends magic-link auth emails through its built-in SMTP,
which is fine for development but rate-limited and unbranded. To send them
through Resend instead:

1. In Resend dashboard → **API Keys**, create a key with `smtp_send` scope.
2. In Resend → **Domains**, verify the sending domain (e.g. `fullscope.sa`).
   Set up the DKIM, SPF, and Return-Path DNS records exactly as Resend
   instructs and wait for verification.
3. In Supabase → **Project Settings → Auth → SMTP Settings**:
   - Host: `smtp.resend.com`
   - Port: `465` (SSL) or `587` (STARTTLS)
   - Username: `resend`
   - Password: the Resend API key from step 1
   - Sender email: must match a verified address (e.g. `noreply@fullscope.sa`)
   - Sender name: `Full Scope`
4. Save. Send a test magic link to your own inbox to confirm delivery and
   that DKIM/SPF pass (use [https://www.mail-tester.com](https://www.mail-tester.com)
   if needed).

The app code does not change — `supabase.auth.signInWithOtp(...)` continues
to work; Supabase just routes through Resend's SMTP relay.

## Replacing the placeholder users

The seed inserts three rows into `users` with placeholder emails (`hr@fullscope.sa`,
`pm@fullscope.sa`, `partner@fullscope.sa`). Before going live with real Full Scope
staff:

1. Decide on the production email per role.
2. In Supabase SQL Editor, run:

   ```sql
   update users
     set email     = 'real.email@fullscope.sa',
         full_name = 'Real Name'
     where id = '22222222-0000-0000-0000-000000000001';   -- HR
   ```

3. Repeat for the practice manager and managing partner UUIDs (see `supabase/seed.sql`).
4. In Supabase → **Authentication → Users**, invite the new email addresses
   so they can complete the magic-link flow.

## Vercel region — Frankfurt (fra1)

`vercel.json` already pins server functions to `fra1`. This is the closest
EU region to KSA + UAE and aligns with the C6 data-residency default for
GCC tenants. If you later add edge runtime functions, set the same region
explicitly via `export const runtime = 'nodejs'` and `export const preferredRegion = 'fra1'`.

## Custom email-from per tenant

For Phase 1, `RESEND_FROM` is a single env var. When you onboard a second
tenant that wants its own sending domain, swap to a per-tenant lookup:

1. Add a `firm_settings.email_from_address` column.
2. In `lib/email/resend.ts`, accept `from` as an argument (already supported)
   and have call sites pass `tenant.email_from_address` instead of relying on
   the env var.
3. Verify each tenant's domain in Resend's dashboard before activating.

## ANTHROPIC_API_KEY — AI agent (Claude)

The Disbursement Workflow ships with an AI Agent that calls Anthropic's
Claude API to pre-fill the 19-item compliance checklist and (optionally)
auto-advance the stage. Without a key the app falls back to canned mock
responses, so dev does not break — but the demo needs a real key.

1. Create a key at [https://console.anthropic.com](https://console.anthropic.com) →
   **Settings → API Keys → Create Key**. Note the key (it is shown once).

2. **Locally** — add to `.env.local`:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```

   Restart `next dev` so the new env is picked up.

3. **In Vercel** — Project Settings → **Environment Variables**:
   - Name: `ANTHROPIC_API_KEY`
   - Value: the key from step 1
   - Environments: Production + Preview + Development
   - Save, then redeploy (or trigger a new deployment) so the env is
     baked into the runtime.

4. The agent run loops through 19 checklist items in series and can take
   ~30 seconds. The relevant page sets `export const maxDuration = 60` on
   the workflow detail route to extend the Vercel function timeout above
   the default 10 s. If you ever bump the loop count, raise this to match.

5. Cost: Claude Sonnet 4.5 is currently $3 / MTok input + $15 / MTok output;
   a single 19-item run typically costs **10–30 cents**. The agent records
   the per-run cost in `dms_workflow_agent_runs.cost_usd` for transparency.

## Adding new transactional templates

Templates live in `lib/email/templates/`. Each exports a `render*` function
returning `{ subject, html, text }`. Pattern:

1. Add the new template file.
2. Import it from the relevant server action.
3. Call `sendEmail({ to, subject, html, text, locale })` from the action.
4. Make the call best-effort — log failures, never block the primary write.
