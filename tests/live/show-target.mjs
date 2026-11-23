// Prints which Supabase project the live tests would use, without printing the key:
//   node tests/live/show-target.mjs
// Reads the same settings as the tests (environment, then .env.live.local). Makes no network request.
import { LIVE_ENV_FILE } from './live-env.mjs'
import { existsSync } from 'node:fs'

const url = process.env.WEBTOWN_LIVE_SUPABASE_URL ?? ''
const key = process.env.WEBTOWN_LIVE_SUPABASE_KEY ?? ''
let ref = '(not set)'
try {
  if (url) {
    const host = new URL(url).hostname
    ref = host.endsWith('.supabase.co') ? host.slice(0, -'.supabase.co'.length) : `(not a supabase.co address: ${host})`
  }
} catch {
  ref = '(not a valid URL)'
}
const kind = !key ? '(not set)' : key.startsWith('sb_publishable_') ? 'publishable (sb_publishable_...)' : 'unrecognised format (expected sb_publishable_...)'

console.log(`settings file:  ${existsSync(LIVE_ENV_FILE) ? '.env.live.local found' : '.env.live.local not found (environment only)'}`)
console.log(`WEBTOWN_LIVE:   ${process.env.WEBTOWN_LIVE === '1' ? '1 (live tests will run)' : 'not 1 (live tests will skip)'}`)
console.log(`project ref:    ${ref}`)
console.log(`key:            ${kind}, ${key.length} characters`)
