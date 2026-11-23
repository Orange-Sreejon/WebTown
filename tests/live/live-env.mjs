// Settings for the live tests (a REAL Supabase test project), from the environment or from the git-ignored file
// `.env.live.local` at the repository root. Variables already set in the environment win over the file.
//
// Only three names are read: WEBTOWN_LIVE, WEBTOWN_LIVE_SUPABASE_URL, WEBTOWN_LIVE_SUPABASE_KEY. The key must be the
// project's PUBLISHABLE key; a secret (service role) key is refused, without being printed. Nothing here prints a
// key. Imported for its effect by the live Playwright config and by every live spec.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const LIVE_ENV_FILE = join(root, '.env.live.local')
const NAMES = new Set(['WEBTOWN_LIVE', 'WEBTOWN_LIVE_SUPABASE_URL', 'WEBTOWN_LIVE_SUPABASE_KEY'])

/** `KEY=value` lines; `#` comments and blank lines ignored; optional quotes removed. Unknown names are refused. */
export function parseLiveEnv(text) {
  const out = {}
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) throw new Error(`.env.live.local line ${i + 1}: expected NAME=value`)
    if (!NAMES.has(m[1])) throw new Error(`.env.live.local line ${i + 1}: ${m[1]} is not a live-test setting (only ${[...NAMES].join(', ')})`)
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').trim()
  }
  return out
}

/** Secret keys: `sb_secret_...`, or a legacy JWT whose role is `service_role` (same rule as src/cloud/config.ts). */
export function looksLikeSecretKey(key) {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'service_role'
  } catch {
    return false
  }
}

if (existsSync(LIVE_ENV_FILE)) {
  const fromFile = parseLiveEnv(readFileSync(LIVE_ENV_FILE, 'utf8'))
  for (const [name, value] of Object.entries(fromFile)) {
    if (process.env[name] === undefined || process.env[name] === '') process.env[name] = value
  }
}

const key = process.env.WEBTOWN_LIVE_SUPABASE_KEY ?? ''
if (key && looksLikeSecretKey(key)) {
  throw new Error('WEBTOWN_LIVE_SUPABASE_KEY is a secret (service role) key. Use the project\'s publishable key; the secret key must never be used by these tests.')
}
