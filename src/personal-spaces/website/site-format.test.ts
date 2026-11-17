import { describe, expect, it } from 'vitest'
import { displayHost, formatUpdated } from './site-format'

describe('formatUpdated', () => {
  it('shows a short date in UTC', () => {
    expect(formatUpdated('2026-11-16T12:00:00.000Z')).toBe('16 Nov 2026')
    expect(formatUpdated('2026-01-01T00:00:00Z')).toBe('1 Jan 2026')
    expect(formatUpdated('2026-12-31T23:59:59.999Z')).toBe('31 Dec 2026')
  })

  it('does not depend on the local time zone', () => {
    // Late in the day in UTC is still the same date everywhere.
    expect(formatUpdated('2026-03-05T23:30:00.000Z')).toBe('5 Mar 2026')
    expect(formatUpdated('2026-03-05T00:30:00.000Z')).toBe('5 Mar 2026')
  })

  it.each(['', 'yesterday', '2026-13-45', null, undefined, 42])('says so when the date is unreadable: %j', value => {
    expect(formatUpdated(value as unknown as string)).toBe('an unknown date')
  })
})

describe('displayHost', () => {
  it('gives the host, with a port when there is one', () => {
    expect(displayHost('https://example.com/a?b=1#c')).toBe('example.com')
    expect(displayHost('https://sub.example.org:8443/x')).toBe('sub.example.org:8443')
  })

  it('gives nothing for something that is not an address', () => {
    expect(displayHost('')).toBe('')
    expect(displayHost('not a url')).toBe('')
  })
})
