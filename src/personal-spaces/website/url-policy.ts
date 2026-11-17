import { SITE_LIMITS } from './site-types'

/** The outcome of checking an external link. */
export type UrlCheck =
  | {
      ok: true
      /** The normalised address to store and to put in an anchor. */
      href: string
      /** The host in the form the browser will connect to (punycode for non-ASCII names). */
      hostname: string
    }
  /** eason is a sentence the owner can act on. */
  | { ok: false; reason: string }

/** Host names that only exist on a private network or the machine itself. */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.localdomain'] as const

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
// A real top-level domain: letters, or a punycode label such as xn--p1ai.
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

// Whitespace and control characters. The URL parser silently deletes tabs and
// line breaks, which would let `https://exa<newline>mple.com` through unseen.
const FORBIDDEN_CHARACTERS = /[\u0000-\u0020\u007f-\u009f\u2028\u2029\\]/

const fail = (reason: string): UrlCheck => ({ ok: false, reason })

/**
 * Decides whether an owner-supplied address may become a link on the website.
 *
 * Only `https:` addresses to a public host name are accepted. The address is
 * parsed with the platform's `URL` class, never inspected with string
 * prefixes, so `javascript:`, `data:`, `http:`, `ftp:`, `file:`, `blob:`,
 * mixed-case and look-alike forms are all handled by the parser's own
 * understanding of schemes.
 *
 * Accepted: paths, queries and fragments, and an explicit port from 1 to 65535
 * (`https://example.com:8443/`). Refused: other schemes, credentials
 * (`user:pass@`), port 0, IP addresses (IPv4 or IPv6), `localhost` and
 * private suffixes, single-label hosts, and anything over 2048 characters.
 *
 * Pure and Phaser-free. The renderer calls it again before building an
 * anchor, so stored data is never trusted on its own.
 */
export function validateExternalUrl(input: unknown): UrlCheck {
  if (typeof input !== 'string') return fail('Enter a web address.')

  const text = input.trim()
  if (text.length === 0) return fail('Enter a web address.')
  if (text.length > SITE_LIMITS.maxUrlLength) {
    return fail(`That address is too long (the limit is ${SITE_LIMITS.maxUrlLength} characters).`)
  }
  if (FORBIDDEN_CHARACTERS.test(text)) {
    return fail('A web address cannot contain spaces, line breaks or backslashes.')
  }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return fail("That doesn't look like a valid web address. Start it with https://")
  }

  if (url.protocol !== 'https:') {
    return fail('Only https:// addresses are allowed.')
  }
  if (url.username !== '' || url.password !== '') {
    return fail('Addresses with a user name or password are not allowed.')
  }
  // An explicit port is fine on https (https://example.com:8443). The default, 443,
  // is dropped by the parser, so anything left here was typed on purpose. Port 0 is
  // not a usable port, and the parser already refuses anything above 65535.
  if (url.port !== '' && !(Number(url.port) >= 1 && Number(url.port) <= 65535)) {
    return fail('A port number must be between 1 and 65535.')
  }

  // Strip the root-label dot so `example.com.` and `example.com` are judged alike.
  const host = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname
  if (host.length === 0) return fail('That address has no website name. Try https://example.com')
  if (host.startsWith('[')) return fail('Addresses made of numbers (IP addresses) are not allowed.')
  if (IPV4.test(host)) return fail('Addresses made of numbers (IP addresses) are not allowed.')
  if (host === 'localhost' || PRIVATE_SUFFIXES.some(suffix => host.endsWith(suffix))) {
    return fail("That address points at a private network, so visitors can't open it.")
  }

  const labels = host.split('.')
  const tld = labels[labels.length - 1]!
  if (labels.length < 2 || labels.some(label => label.length === 0) || !TLD.test(tld)) {
    return fail("That doesn't look like a public website name. Try https://example.com")
  }

  return { ok: true, href: url.href, hostname: host }
}
