import { describe, expect, it } from 'vitest'
import { isFromHost, parseHostMessage, rateLimiter, splitPageTarget } from './host-protocol'

describe('parseHostMessage', () => {
  it('accepts exactly the known messages', () => {
    for (const t of ['ready', 'rendered', 'unexpected-nav', 'loop-detected', 'rate-limited']) {
      expect(parseHostMessage({ t, extra: 'dropped' })).toEqual({ t })
    }
    expect(parseHostMessage({ t: 'nav', kind: 'page', value: 'about.html#me' })).toEqual({ t: 'nav', kind: 'page', value: 'about.html#me' })
    expect(parseHostMessage({ t: 'nav', kind: 'external', value: 'https://example.com/' }))
      .toEqual({ t: 'nav', kind: 'external', value: 'https://example.com/' })
  })

  it('drops everything else', () => {
    const bad: unknown[] = [null, undefined, 'ready', 42, [], ['ready'], {}, { t: 1 }, { t: 'close' }, { t: 'render', html: 'x' },
      { t: 'nav' }, { t: 'nav', kind: 'script', value: 'x' }, { t: 'nav', kind: 'page', value: '' },
      { t: 'nav', kind: 'page', value: 7 }, { t: 'nav', kind: 'page', value: 'x'.repeat(2049) }, { type: 'close' }]
    for (const data of bad) expect(parseHostMessage(data), JSON.stringify(data) ?? String(data)).toBeNull()
  })

  it('survives hostile objects', () => {
    const trap = new Proxy({}, { get: () => { throw new Error('boom') } })
    expect(parseHostMessage(trap)).toBeNull()
  })
})

describe('isFromHost', () => {
  const host = {}
  it('needs the very host window and the opaque origin', () => {
    expect(isFromHost({ source: host, origin: 'null' }, host)).toBe(true)
    expect(isFromHost({ source: {}, origin: 'null' }, host)).toBe(false)
    expect(isFromHost({ source: host, origin: 'http://localhost:5173' }, host)).toBe(false)
    expect(isFromHost({ source: null, origin: 'null' }, null)).toBe(false)
  })
})

describe('rateLimiter', () => {
  it('allows max per window, then refuses until the window passes', () => {
    let t = 0
    const allow = rateLimiter(3, 1000, () => t)
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false])
    t = 999
    expect(allow()).toBe(false)
    t = 1000
    expect(allow()).toBe(true)
  })
})

describe('splitPageTarget', () => {
  it('splits off the fragment', () => {
    expect(splitPageTarget('about.html')).toEqual({ page: 'about.html', fragment: '' })
    expect(splitPageTarget('about.html#me#too')).toEqual({ page: 'about.html', fragment: 'me#too' })
  })
})
