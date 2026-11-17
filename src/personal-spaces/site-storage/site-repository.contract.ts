import { beforeEach, describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import { createDefaultSite } from '../website/default-site'
import type { SiteRepository } from '../website/site-repository'
import type { SiteContent } from '../website/site-types'
import type { SiteLoadReport } from './site-record'

/**
 * The behaviour every `SiteRepository` must have, whatever it stores into.
 * Run against the in-memory and the IndexedDB repositories, and the same suite
 * will run against a remote one in Phase 3b.
 */

export interface RepositoryUnderTest {
  repository: SiteRepository
  /** Writes raw data under a key with no checks, to stand in for a damaged record. */
  seedUnchecked(houseId: string, raw: unknown): Promise<void>
  /** What the load reports collected so far. */
  reports: SiteLoadReport[]
}

export interface Harness {
  /** A fresh, empty repository with its own clock. */
  create(now: () => string): Promise<RepositoryUnderTest>
}

/** A clock that moves forward one second per call, so every stamp is distinct and ordered. */
export function steppingClock(): () => string {
  let n = 0
  return () => new Date(Date.UTC(2026, 10, 16, 12, 0, n++)).toISOString()
}

const BASE = '2026-11-16T00:00:00.000Z'
const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1]
const siteFor = (houseId: string, title?: string): SiteContent => {
  const site = createDefaultSite(houseId, BASE)
  if (title) site.title = title
  return site
}

export function describeSiteRepositoryContract(name: string, harness: Harness): void {
  describe(`${name}: the SiteRepository contract`, () => {
    let sut: RepositoryUnderTest
    let clock: () => string

    beforeEach(async () => {
      clock = steppingClock()
      sut = await harness.create(clock)
    })

    const refusal = async (promise: Promise<unknown>): Promise<ValidationError> => {
      try {
        await promise
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        return error as ValidationError
      }
      throw new Error('expected a ValidationError')
    }

    describe('loading', () => {
      it('gives a house nobody has edited the default site, ready to browse', async () => {
        const site = await sut.repository.load('house-b')
        expect(site.houseId).toBe('house-b')
        expect(site.title).toBe('Welcome to House B!')
        expect(site.projects.length).toBeGreaterThan(0)
        expect(site.links.length).toBeGreaterThan(0)
      })

      it('does not store the default: it follows the clock until something is saved', async () => {
        const first = await sut.repository.load('house-b')
        const second = await sut.repository.load('house-b')
        expect(second.updatedAt > first.updatedAt).toBe(true)
        expect(sut.reports.map(r => r.origin)).toEqual(['default', 'default'])
      })

      it('refuses a house id that cannot be a key', async () => {
        for (const bad of ['', 'House A', '../x', 'a'.repeat(41), '<script>']) {
          await refusal(sut.repository.load(bad))
        }
        await refusal(sut.repository.load(undefined as unknown as string))
        await refusal(sut.repository.load(42 as unknown as string))
      })

      it('returns read-only data that nobody else shares', async () => {
        await sut.repository.save(siteFor('house-a', 'Mine'))
        const one = await sut.repository.load('house-a')
        const two = await sut.repository.load('house-a')
        expect(one).toEqual(two)
        expect(one).not.toBe(two)
        expect(Object.isFrozen(one)).toBe(true)
        expect(Object.isFrozen(one.projects)).toBe(true)
        expect(() => { (one as unknown as { title: string }).title = 'x' }).toThrow(TypeError)
      })
    })

    describe('saving', () => {
      it('stores a website and loads it back', async () => {
        const saved = await sut.repository.save(siteFor('house-a', 'My Page'))
        const loaded = await sut.repository.load('house-a')
        expect(loaded).toEqual(saved)
        expect(loaded.title).toBe('My Page')
        expect(last(sut.reports)?.origin).toBe('saved')
      })

      it('stamps the save time itself, ignoring the one it was given', async () => {
        const input = siteFor('house-a')
        input.updatedAt = '1999-01-01T00:00:00.000Z'
        const saved = await sut.repository.save(input)
        expect(saved.updatedAt).not.toBe('1999-01-01T00:00:00.000Z')
        expect(saved.updatedAt.startsWith('2026-11-16T12:00:')).toBe(true)
      })

      it('returns the cleaned data that was stored', async () => {
        const input = siteFor('house-a')
        input.title = '  Padded\u0000  '
        input.theme.background = '#ffffff'
        input.theme.text = '#000000'
        input.theme.link = '#0000ee'
        input.links[0]!.url = 'HTTPS://Example.com:8443/Path?x=1#frag'
        const saved = await sut.repository.save(input)
        expect(saved.title).toBe('Padded')
        expect(saved.theme.background).toBe('#FFFFFF')
        expect(saved.theme.link).toBe('#0000EE')
        expect(saved.links[0]!.url).toBe('https://example.com:8443/Path?x=1#frag')
        expect(await sut.repository.load('house-a')).toEqual(saved)
      })

      it('updates: the second save replaces the first and moves updatedAt forward', async () => {
        const first = await sut.repository.save(siteFor('house-a', 'One'))
        const second = await sut.repository.save(siteFor('house-a', 'Two'))
        expect(second.updatedAt > first.updatedAt).toBe(true)
        expect((await sut.repository.load('house-a')).title).toBe('Two')
      })

      it('lets every field be edited and removed', async () => {
        const site = siteFor('house-a')
        site.projects = []
        site.links = []
        site.about.body = ''
        site.profile.tagline = ''
        await sut.repository.save(site)
        const loaded = await sut.repository.load('house-a')
        expect(loaded.projects).toEqual([])
        expect(loaded.links).toEqual([])
        expect(loaded.about.body).toBe('')
      })

      it('keeps the caller’s object and the stored data apart', async () => {
        const input = siteFor('house-a', 'Original')
        const saved = await sut.repository.save(input)

        input.title = 'Changed after saving'
        input.projects[0]!.title = 'Changed'
        saved.title = 'Changed the result'
        saved.theme.text = '#123456'

        const loaded = await sut.repository.load('house-a')
        expect(loaded.title).toBe('Original')
        expect(loaded.projects[0]!.title).not.toBe('Changed')
        expect(loaded.theme.text).not.toBe('#123456')
      })

      it('applies saves in the order they were made', async () => {
        await Promise.all([
          sut.repository.save(siteFor('house-a', 'First')),
          sut.repository.save(siteFor('house-a', 'Second')),
          sut.repository.save(siteFor('house-a', 'Third')),
        ])
        expect((await sut.repository.load('house-a')).title).toBe('Third')
      })
    })

    describe('invalid data', () => {
      it('refuses it with every problem listed, and stores nothing', async () => {
        const bad = siteFor('house-a')
        bad.title = ''
        bad.profile.displayName = ''
        bad.links[0]!.url = 'http://example.com'
        bad.theme.text = 'red'

        const error = await refusal(sut.repository.save(bad))
        expect(error.issues.map(i => i.path)).toEqual(
          expect.arrayContaining(['title', 'profile.displayName', 'links[0].url', 'theme.text']),
        )
        expect(error.message.length).toBeGreaterThan(0)

        const loaded = await sut.repository.load('house-a')
        expect(loaded.title).toBe('Welcome to House A!') // still the default
        expect(last(sut.reports)?.origin).toBe('default')
      })

      it('keeps the last good version when a later save is refused', async () => {
        await sut.repository.save(siteFor('house-a', 'Good'))
        await refusal(sut.repository.save({ ...siteFor('house-a'), title: '' }))
        expect((await sut.repository.load('house-a')).title).toBe('Good')
      })

      it.each([null, undefined, 'text', 42, [], {}])('refuses %j', async input => {
        await refusal(sut.repository.save(input as unknown as SiteContent))
      })

      it('refuses unsafe and unsupported links', async () => {
        for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com', 'https://localhost/',
          'https://127.0.0.1/', 'https://user:pw@example.com/', 'https://example.com:0/']) {
          const site = siteFor('house-a')
          site.links[0]!.url = url
          const error = await refusal(sut.repository.save(site))
          expect(error.issues.some(i => i.path === 'links[0].url'), url).toBe(true)
        }
      })

      it('accepts a link with an explicit https port', async () => {
        const site = siteFor('house-a')
        site.links[0]!.url = 'https://example.com:8443/'
        expect((await sut.repository.save(site)).links[0]!.url).toBe('https://example.com:8443/')
      })

      it('refuses a house id that is not a house', async () => {
        await refusal(sut.repository.save({ ...siteFor('house-a'), houseId: 'House A' }))
        await refusal(sut.repository.save({ ...siteFor('house-a'), houseId: '' }))
      })

      it('does not store properties that are not part of a website', async () => {
        const polluted = { ...siteFor('house-a'), html: '<b>x</b>', script: 'alert(1)' } as SiteContent
        const saved = await sut.repository.save(polluted)
        expect(Object.keys(saved).sort()).toEqual(Object.keys(siteFor('house-a')).sort())
      })
    })

    describe('literal text', () => {
      const HOSTILE = '<script>alert(1)</script> <img src=x onerror=alert(1)> &lt;b&gt;'

      it('stores HTML-looking text exactly as typed, and gives it back the same', async () => {
        const site = siteFor('house-a')
        site.title = '<script>alert(1)</script>'
        site.profile.tagline = HOSTILE
        site.home.welcome = HOSTILE
        site.about.body = `One\n\n${HOSTILE}`
        site.projects[0]!.description = HOSTILE
        site.links[0]!.label = '<b>bold</b>'

        await sut.repository.save(site)
        const loaded = await sut.repository.load('house-a')
        expect(loaded.title).toBe('<script>alert(1)</script>')
        expect(loaded.profile.tagline).toBe(HOSTILE)
        expect(loaded.home.welcome).toBe(HOSTILE)
        expect(loaded.about.body).toBe(`One\n\n${HOSTILE}`)
        expect(loaded.projects[0]!.description).toBe(HOSTILE)
        expect(loaded.links[0]!.label).toBe('<b>bold</b>')
      })
    })

    describe('houses are independent', () => {
      it('keeps each house’s website separate', async () => {
        await sut.repository.save(siteFor('house-a', 'Alpha'))
        await sut.repository.save(siteFor('house-b', 'Beta'))

        expect((await sut.repository.load('house-a')).title).toBe('Alpha')
        expect((await sut.repository.load('house-b')).title).toBe('Beta')
        expect((await sut.repository.load('house-c')).title).toBe('Welcome to House C!')
      })

      it('does not let saving one house change another', async () => {
        await sut.repository.save(siteFor('house-a', 'Alpha'))
        const beta = await sut.repository.save(siteFor('house-b', 'Beta'))
        await sut.repository.save(siteFor('house-a', 'Alpha 2'))
        expect(await sut.repository.load('house-b')).toEqual(beta)
      })

      it('files a site under its own house id, never another', async () => {
        const saved = await sut.repository.save(siteFor('house-a', 'Mine'))
        expect(saved.houseId).toBe('house-a')
        expect((await sut.repository.load('house-b')).title).not.toBe('Mine')
      })
    })

    describe('damaged stored data', () => {
      const damaged: Array<[string, unknown]> = [
        ['not an object', 'a string'],
        ['a number', 42],
        ['an array', [1, 2, 3]],
        ['an empty object', {}],
        ['another schema version', { ...siteFor('house-a'), schemaVersion: 99 }],
        ['a missing title', { ...siteFor('house-a'), title: undefined }],
        ['a javascript: link', { ...siteFor('house-a'), links: [{ id: 'l', label: 'x', url: 'javascript:alert(1)' }] }],
        ['unreadable colours', { ...siteFor('house-a'), theme: { ...siteFor('house-a').theme, text: 'red' } }],
        ['text over the limit', { ...siteFor('house-a'), title: 'x'.repeat(5000) }],
      ]

      it.each(damaged)('shows the default instead, and says so, when it is %s', async (_name, raw) => {
        await sut.seedUnchecked('house-a', raw)
        const site = await sut.repository.load('house-a')

        expect(site.title).toBe('Welcome to House A!')
        const report = last(sut.reports)!
        expect(report.origin).toBe('recovered')
        expect(report.houseId).toBe('house-a')
        expect(report.problems.length).toBeGreaterThan(0)
      })

      it('does not delete or rewrite the damaged record by loading it', async () => {
        const raw = { ...siteFor('house-a'), schemaVersion: 99, title: 'From the future' }
        await sut.seedUnchecked('house-a', raw)
        await sut.repository.load('house-a')
        await sut.repository.load('house-a')
        expect(sut.reports.map(r => r.origin)).toEqual(['recovered', 'recovered'])
      })

      it('lets the owner save over a damaged record, which then loads normally', async () => {
        await sut.seedUnchecked('house-a', { nonsense: true })
        expect(await sut.repository.load('house-a')).toBeDefined()
        await sut.repository.save(siteFor('house-a', 'Repaired'))
        const loaded = await sut.repository.load('house-a')
        expect(loaded.title).toBe('Repaired')
        expect(last(sut.reports)?.origin).toBe('saved')
      })

      it('does not let a damaged record in one house affect another', async () => {
        await sut.seedUnchecked('house-a', { nonsense: true })
        await sut.repository.save(siteFor('house-b', 'Fine'))
        expect((await sut.repository.load('house-b')).title).toBe('Fine')
        expect(last(sut.reports)?.origin).toBe('saved')
      })

      it('does not trust stored text: hostile text is shown as text and links are policed', async () => {
        const raw = siteFor('house-a')
        raw.title = '<script>alert(1)</script>'
        raw.links = [{ id: 'l', label: 'x', url: 'https://example.com/' }]
        await sut.seedUnchecked('house-a', raw)
        const loaded = await sut.repository.load('house-a')
        expect(loaded.title).toBe('<script>alert(1)</script>')
        expect(last(sut.reports)?.origin).toBe('saved')
      })

      it('drops unknown properties found in a stored record', async () => {
        await sut.seedUnchecked('house-a', { ...siteFor('house-a'), html: '<b>x</b>', theme: { ...siteFor('house-a').theme, css: 'x' } })
        const loaded = await sut.repository.load('house-a')
        expect('html' in loaded).toBe(false)
        expect('css' in loaded.theme).toBe(false)
      })
    })
  })
}
