/**
 * Where WebTown's Supabase project is, from the build's environment. Only the project URL and the publishable
 * (anon) key are read: both are meant to be public, and access is decided by Row Level Security in the
 * database. A service-role key must never be given to the browser; this module refuses one.
 */
export interface CloudConfig {
  url: string
  publishableKey: string
}

export type ConfigResult = { ok: true; config: CloudConfig } | { ok: false; reason: string }

/** Reads and checks the two settings. Missing settings mean "no backend": WebTown runs on this device only. */
export function readCloudConfig(env: Record<string, unknown>): ConfigResult {
  const url = typeof env['VITE_SUPABASE_URL'] === 'string' ? env['VITE_SUPABASE_URL'].trim() : ''
  const key = typeof env['VITE_SUPABASE_PUBLISHABLE_KEY'] === 'string' ? env['VITE_SUPABASE_PUBLISHABLE_KEY'].trim() : ''
  if (url === '' && key === '') return { ok: false, reason: 'not configured' }
  if (url === '' || key === '') return { ok: false, reason: 'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must both be set.' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'VITE_SUPABASE_URL is not a web address.' }
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    return { ok: false, reason: 'VITE_SUPABASE_URL must use https.' }
  }
  if (looksLikeServiceKey(key)) {
    return { ok: false, reason: 'That is a secret (service role) key. Use the publishable key; the secret key must never reach the browser.' }
  }
  return { ok: true, config: { url: parsed.origin, publishableKey: key } }
}

/** Secret keys: `sb_secret_...`, or a legacy JWT whose role is `service_role`. */
function looksLikeServiceKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown }
    return payload.role === 'service_role'
  } catch {
    return false
  }
}
