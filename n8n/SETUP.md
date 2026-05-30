# n8n Cloud Setup — Voucher Audit (Phase 1)

This guide walks you through importing the **Voucher Audit** workflow into n8n
Cloud, wiring up credentials, activating it, and firing a test webhook so you
can see Claude run the 13 audit checks and write results back to Supabase end
to end — all **before** we touch the app code.

Estimated time: **15 minutes**.

---

## What this workflow does

1. **Webhook** receives `{ voucher_id, tenant_id }` from the Full Scope app
2. **Fetches** the voucher + project + developer + supplier + escrow account + signer + uploads + invoice allocations from Supabase
3. **Fetches** all project contracts (with line items), completion certificates, and the last 20 vouchers (for sequence checking)
4. **Creates** an `escrow_voucher_agent_runs` row (status = `running`)
5. **Flips** the voucher status to `agent_running`
6. **Calls Claude** once with all the context and asks it to run all 13 audit rules, returning structured JSON
7. **Parses** the response, **inserts** one row per check into `escrow_voucher_agent_checks`
8. **Finalizes** the run record with pass/fail/warn counts and token usage
9. **Updates** the voucher status (`needs_review` if AI passed; `rejected` if AI flagged blockers)
10. **Sends an email** to the trustee via Resend with a deep-link back to the voucher
11. **Responds** to the webhook with the verdict

Phase 1 limitation: Claude works only from the **structured metadata** in your database, not the PDF contents. Many of the 13 rules (account sufficiency, voucher total, developer name on invoice, signer authorization, etc.) only need metadata, so they'll work perfectly. Rules that require reading the actual PDF (price-match against invoice text, completion-cert numbers, receipt confirmations) will return `needs_info` for now. Phase 2 adds real PDF download + attachment.

---

## Step 1 — Import the workflow

1. Open your **n8n Cloud** workspace → **Workflows** (left sidebar)
2. Click the **⋯** menu (top right) → **Import from File**
3. Select `n8n/voucher-audit-phase1.json` from this repo
4. You should see **18 nodes** appear on the canvas, connected in a flow from `Webhook` to `Respond to Webhook`
5. **Don't activate it yet** — credentials first

---

## Step 2 — Add environment variables

The workflow references 4 values via `{{ $env.VAR_NAME }}`. Set them in n8n Cloud:

1. Click your workspace avatar (top-right) → **Settings**
2. In the sidebar, click **Variables**
3. Add the following four variables (click **+ Add Variable** for each):

| Key                          | Where to find the value                                                                         |
|------------------------------|-------------------------------------------------------------------------------------------------|
| `SUPABASE_URL`               | Supabase Dashboard → Project Settings → API → **Project URL** (e.g., `https://abcd.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase Dashboard → Project Settings → API → **service_role** secret (NOT the `anon` key)       |
| `ANTHROPIC_API_KEY`          | console.anthropic.com → API keys (the same `sk-ant-...` you set in Vercel)                       |
| `RESEND_API_KEY`             | resend.com → API Keys (the same `re_...` you set in Vercel)                                      |

(Optional) Add a 5th variable `TRUSTEE_NOTIFY_EMAIL` set to the address you want notifications sent to. If you skip it, the workflow falls back to `support@elevatemybusiness.co`.

> **If your n8n Cloud plan doesn't show a Variables tab**, the alternative is to hard-code the values into the HTTP Request nodes (less clean but always works). Tell me and I'll generate a version that uses n8n Credentials instead.

---

## Step 3 — Activate the workflow

1. Go back to the **Voucher Audit — Phase 1** workflow canvas
2. Click the **toggle in the top-right** (the one labeled **Inactive**) — it should turn green and say **Active**
3. Click the **Webhook** node (first node on the left)
4. In the right panel, under **Production URL**, **copy the URL**. It will look like:
   ```
   https://YOUR-WORKSPACE.app.n8n.cloud/webhook/voucher-audit
   ```
5. **Paste that URL into this chat** — I need it to add to the Full Scope app code as an env var (`N8N_VOUCHER_AUDIT_WEBHOOK_URL`) in step 5.

---

## Step 4 — Test it with curl (no app needed)

We can fire the webhook by hand against the seed voucher data to confirm the
whole flow works before wiring it into the app.

First, **create a test voucher** in Supabase so the agent has something to chew
on. Run this in the Supabase SQL Editor:

```sql
-- Create a test voucher on Madra Plot 2 for Khalid Security (non-construction)
insert into escrow_vouchers (
  id, tenant_id, project_id, voucher_number, voucher_date, total_sar,
  beneficiary_supplier_id, source_escrow_account_id, expense_nature,
  signed_by_authorized_signer_id, status, notes
) values (
  'eeee9001-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'eeee0002-0000-0000-0000-000000000001',
  'VCH-MP2-001', current_date, 60000.00,
  'eeee0032-0000-0000-0000-000000000001',  -- Khalid Security
  'eeee0012-0000-0000-0000-000000000001',  -- non-construction account
  'non_construction',
  'eeee0023-0000-0000-0000-000000000001',  -- Sara Al-Otaibi (500K limit)
  'uploaded',
  'Test voucher for n8n flow.'
) on conflict (id) do nothing;
```

Then run this curl from your terminal (replace the URL with your webhook URL from step 3):

```bash
curl -X POST "https://YOUR-WORKSPACE.app.n8n.cloud/webhook/voucher-audit" \
  -H "Content-Type: application/json" \
  -d '{
    "voucher_id": "eeee9001-0000-0000-0000-000000000001",
    "tenant_id":  "11111111-1111-1111-1111-111111111111"
  }'
```

Expected response within ~10–15 seconds:

```json
{
  "ok": true,
  "voucher_id": "eeee9001-0000-0000-0000-000000000001",
  "verdict": "approved" | "needs_review" | "rejected",
  "pass": 7,
  "fail": 0,
  "warn": 6
}
```

> Counts will vary depending on how Claude interprets the rules. A typical Phase 1 run will show ~7 passes (metadata-checkable rules) and ~6 `needs_info` (PDF-only rules).

You should also see an **email arrive** at `support@elevatemybusiness.co` (or whatever `TRUSTEE_NOTIFY_EMAIL` you set) within a minute.

To inspect the checks Claude wrote, run in Supabase:

```sql
select rule_code, status, severity, reasoning
from escrow_voucher_agent_checks
where voucher_id = 'eeee9001-0000-0000-0000-000000000001'
order by order_index;
```

---

## Step 5 — Confirm + handoff

Once you see:
- ✅ Webhook responds with `ok: true`
- ✅ 13 rows in `escrow_voucher_agent_checks` for the test voucher
- ✅ Voucher status flipped (in `escrow_vouchers.status`)
- ✅ Email landed in inbox

…paste the **production webhook URL** from step 3 into chat. I'll wire it into
the app so the next step (voucher upload form + voucher detail page) can fire
this flow automatically whenever a trustee or developer uploads a voucher.

---

## If something breaks

Open the **Executions** tab in n8n (left sidebar) and click the failed run. You'll see exactly which node failed and the error message. Paste me a screenshot or the error text and I'll fix the workflow.

Common Phase 1 issues:
- **"Voucher not found"** — the `voucher_id` you sent doesn't exist in `escrow_vouchers`. Re-run the SQL in step 4.
- **401 on Supabase calls** — `SUPABASE_SERVICE_ROLE_KEY` env var is wrong, or the URL has a trailing slash.
- **Claude returns non-JSON** — Claude very rarely wraps output in prose. The parse node tries to recover, but if it fails, the execution log will show the raw text.
- **Email never arrives** — your Resend domain (`fullscope.sa`) needs to be verified in resend.com. Until then, change the `from` in the Notify node to a verified address.

---

## Phase 3 — Disbursement Breakdown (AI)

This is a **separate, lightweight workflow** for the new الصرف (disbursement)
module. When any disbursement case PDF is uploaded — from the developer portal,
the Full Scope staff upload screen, OR a magic-link token — the Full Scope app
POSTs `{ case_id, tenant_id }` to this webhook. n8n then:

1. Reads the case + its single combined PDF upload from Supabase
2. Mints a signed Storage URL and downloads the PDF (binary)
3. Sends it to Claude with an Arabic-aware classifier prompt
4. Receives JSON: `{ sections: [{ kind, page_from, page_to, summary_ar }] }`
5. Inserts one row per section into `dsb_breakdown_items` with `source='ai'`
6. Writes an `ai_breakdown_complete` row into `dsb_audit_log`
7. Responds `{ ok, case_id, sections }`

The employee then opens the case and sees the breakdown editor **pre-filled**
with AI suggestions — they can edit, delete, or add rows before approving.

> **Email notifications stay independent.** The existing developer-uploaded
> email fires the moment the case flips to `with_employee` — it does not wait
> on n8n. The AI breakdown is pure pre-fill: if n8n is down the workflow still
> works, just without the head start.

### Setup steps

1. **Import the workflow.** In n8n Cloud → **Workflows** → **Import from File**,
   pick `n8n/dsb-breakdown.json`. You'll see **12 nodes** wired linearly from
   `Webhook` to `Respond to Webhook`.
2. **Env vars.** This workflow re-uses the same n8n variables you set in
   Phase 1/Phase 2 — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ANTHROPIC_API_KEY`. Nothing new to add on the n8n side.
3. **Activate.** Toggle the workflow to **Active**. Click the **Webhook** node
   and copy the **Production URL**. It will look like:
   ```
   https://YOUR-WORKSPACE.app.n8n.cloud/webhook/dsb-breakdown
   ```
4. **Add the URL to Vercel.** In your Vercel project → **Settings** →
   **Environment Variables**, add:

   | Key                              | Value                                                           |
   |----------------------------------|-----------------------------------------------------------------|
   | `N8N_DSB_BREAKDOWN_WEBHOOK_URL`  | the production URL from step 3                                  |

   Redeploy so server actions pick it up.

### Test it end to end

1. Open the developer portal at `/developer/new` (or use a magic-link upload,
   or the staff upload at `/app/disbursements/new`).
2. Create a case and upload any disbursement PDF.
3. Within **~20 seconds**, run in Supabase SQL Editor:
   ```sql
   select kind, page_from, page_to, summary_ar, source, order_index
   from dsb_breakdown_items
   where case_id = '<the case id>'
   order by order_index;
   ```
   You should see one row per section with `source = 'ai'`.
4. The `dsb_audit_log` should have an `ai_breakdown_complete` row.
5. Open the case in the employee inbox — the breakdown editor should show
   the AI-suggested rows ready to review.

### If something breaks

Open **Executions** in n8n and click the failed run.

- **"Case not found"** — case ID didn't match. Verify the row exists and that
  `SUPABASE_SERVICE_ROLE_KEY` is the service-role secret (RLS would otherwise
  hide it).
- **"Case has no uploads to break down"** — the webhook fired before the
  upload row was inserted. The Full Scope helper fires *after* both insert
  + status flip, so this should be rare. If it happens repeatedly, the upload
  row insert is failing silently in the app.
- **"Claude returned non-JSON"** — Claude very occasionally wraps output in
  prose. The parse node tries to recover by slicing the first `{...}` block.
  If it still fails, the execution log shows the raw text.
- **Webhook never gets hit** — `N8N_DSB_BREAKDOWN_WEBHOOK_URL` is unset on
  Vercel, or the workflow is paused. The helper logs
  `[n8n] N8N_DSB_BREAKDOWN_WEBHOOK_URL not set — skipping AI breakdown` when
  unset.

