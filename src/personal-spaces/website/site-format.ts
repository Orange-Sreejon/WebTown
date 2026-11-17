const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * "16 Nov 2026" from an ISO timestamp, in UTC, so everyone sees the same
 * date wherever they are and a test never depends on the machine's locale.
 * Anything unreadable gives "an unknown date".
 */
export function formatUpdated(iso: string): string {
  const time = typeof iso === 'string' ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(time)) return 'an unknown date'
  const date = new Date(time)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]!} ${date.getUTCFullYear()}`
}

/**
 * The host (with its port, if any) of an address that has already passed the
 * URL policy, for showing next to a link. Empty if it cannot be read.
 */
export function displayHost(href: string): string {
  try {
    return new URL(href).host
  } catch {
    return ''
  }
}
