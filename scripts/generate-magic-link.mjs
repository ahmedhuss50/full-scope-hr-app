/**
 * Generate a Supabase magic-link URL for a user, WITHOUT sending email.
 *
 * Usage:
 *   node scripts/generate-magic-link.mjs mahdi@fullscope.sa
 *
 * Reads .env.local from the repo root (no dotenv dependency). Falls back to
 * shell env vars if .env.local is missing.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL  (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   REDIRECT_TO   override the auth callback (default: current Vercel URL)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- Tiny .env loader (no deps) ---
function loadEnvFile(path) {
  try {
    const text = readFileSync(path, 'utf8')
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    /* file missing — fine, fall through to shell env */
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
loadEnvFile(resolve(repoRoot, '.env.local'))
loadEnvFile(resolve(repoRoot, '.env'))

// --- Args ---
const email = process.argv[2]
if (!email) {
  console.error('Usage: node scripts/generate-magic-link.mjs <email>')
  process.exit(1)
}

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error(
    'Missing env. Need NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and ' +
      'SUPABASE_SERVICE_ROLE_KEY in .env.local or the shell.',
  )
  process.exit(1)
}

const redirectTo =
  process.env.REDIRECT_TO ||
  'https://full-scope-hr-j77yskgmq-innuvis.vercel.app/auth/callback'

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo },
})

if (error) {
  console.error('generateLink failed:', error.message)
  process.exit(1)
}

const actionLink = data?.properties?.action_link
if (!actionLink) {
  console.error('No action_link in response. Full payload:')
  console.dir(data, { depth: null })
  process.exit(1)
}

console.log('\n  Magic link for:', email)
console.log('  Redirects to:  ', redirectTo)
console.log('\n  >>> Send this URL to the user (WhatsApp / SMS / etc): <<<\n')
console.log('  ' + actionLink + '\n')
