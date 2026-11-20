/**
 * What WebTown accepts from the website host page (`public/site-host.html`).
 *
 * The host page is sandboxed, so its origin is opaque and arrives as the
 * string "null". WebTown therefore checks three things about every message:
 * it came from the one host frame it created (`event.source`), its origin is
 * exactly "null", and it fits this closed schema. Anything else is dropped.
 * Messages are also rate-limited, so a page cannot flood the app.
 */

export type HostMessage =
  | { t: 'ready' }
  | { t: 'rendered' }
  | { t: 'nav'; kind: 'page' | 'external'; value: string }
  | { t: 'unexpected-nav' }
  | { t: 'loop-detected' }
  | { t: 'rate-limited' }

export const MAX_NAV_VALUE = 2048
export const APP_MESSAGE_LIMIT_PER_SECOND = 30

const SIMPLE = new Set(['ready', 'rendered', 'unexpected-nav', 'loop-detected', 'rate-limited'])

/** The message if it is one WebTown understands, otherwise null. Never throws. */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  let t: unknown
  try {
    t = (data as { t?: unknown }).t
  } catch {
    return null
  }
  if (typeof t !== 'string') return null
  if (SIMPLE.has(t)) return { t } as HostMessage
  if (t !== 'nav') return null
  const { kind, value } = data as { kind?: unknown; value?: unknown }
  if (kind !== 'page' && kind !== 'external') return null
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NAV_VALUE) return null
  return { t: 'nav', kind, value }
}

/** True if a message from `source` with `origin` may be considered at all. */
export function isFromHost(event: { source: unknown; origin: string }, host: unknown): boolean {
  return host !== null && host !== undefined && event.source === host && event.origin === 'null'
}

/** Allows at most `max` calls per `windowMs`. Returns false for calls over the limit. */
export function rateLimiter(max: number, windowMs = 1000, now: () => number = Date.now): () => boolean {
  let start = -Infinity
  let count = 0
  return () => {
    const t = now()
    if (t - start >= windowMs) {
      start = t
      count = 0
    }
    count++
    return count <= max
  }
}

/**
 * A page link's target split into page and fragment: `about.html#me` ->
 * `{ page: 'about.html', fragment: 'me' }`. The builder only ever produces
 * names of real pages (or a missing one, which shows "page not found").
 */
export function splitPageTarget(value: string): { page: string; fragment: string } {
  const hash = value.indexOf('#')
  return hash < 0 ? { page: value, fragment: '' } : { page: value.slice(0, hash), fragment: value.slice(hash + 1) }
}
