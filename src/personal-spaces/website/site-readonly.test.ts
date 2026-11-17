import { describe, expect, expectTypeOf, it } from 'vitest'
import { createDefaultSite } from './default-site'
import { cloneSite, nextEntryId, toReadonlySite } from './site-readonly'
import type { SiteReader, SiteRepository, SiteWriter } from './site-repository'
import type { ReadonlySiteContent, SiteContent } from './site-types'

const NOW = '2026-11-16T12:00:00.000Z'

describe('cloneSite', () => {
  it('copies every field', () => {
    const site = createDefaultSite('house-a', NOW)
    expect(cloneSite(site)).toEqual(site)
  })

  it('shares no object or array with the original', () => {
    const site = createDefaultSite('house-a', NOW)
    const copy = cloneSite(site)
    expect(copy).not.toBe(site)
    expect(copy.profile).not.toBe(site.profile)
    expect(copy.home).not.toBe(site.home)
    expect(copy.about).not.toBe(site.about)
    expect(copy.projects).not.toBe(site.projects)
    expect(copy.projects[0]).not.toBe(site.projects[0])
    expect(copy.links).not.toBe(site.links)
    expect(copy.links[0]).not.toBe(site.links[0])
    expect(copy.theme).not.toBe(site.theme)
  })

  it('lets the copy change without touching the original', () => {
    const site = createDefaultSite('house-a', NOW)
    const copy = cloneSite(site)
    copy.title = 'Changed'
    copy.projects[0]!.title = 'Changed'
    copy.projects.push({ id: 'x', title: 'X', description: '', url: null })
    copy.links.length = 0
    copy.theme.text = '#123456'
    expect(site).toEqual(createDefaultSite('house-a', NOW))
  })

  it('drops properties that are not part of the model', () => {
    const polluted = { ...createDefaultSite('house-a', NOW), html: '<b>x</b>' } as SiteContent
    expect('html' in cloneSite(polluted)).toBe(false)
  })
})

describe('toReadonlySite', () => {
  const asLoose = (value: unknown): Record<string, unknown> => value as Record<string, unknown>

  it('has the same content', () => {
    const site = createDefaultSite('house-a', NOW)
    expect(toReadonlySite(site)).toEqual(site)
  })

  it('refuses writes at every level, at run time', () => {
    const view = toReadonlySite(createDefaultSite('house-a', NOW))
    expect(() => { asLoose(view)['title'] = 'x' }).toThrow(TypeError)
    expect(() => { asLoose(view['profile'])['displayName'] = 'x' }).toThrow(TypeError)
    expect(() => { asLoose(view['theme'])['text'] = '#000000' }).toThrow(TypeError)
    expect(() => { asLoose(view['projects'][0])['title'] = 'x' }).toThrow(TypeError)
    expect(() => { asLoose(view['links'][0])['url'] = 'https://example.net/' }).toThrow(TypeError)
    expect(() => (view['projects'] as unknown as unknown[]).push({})).toThrow(TypeError)
    expect(() => { (view['links'] as unknown as unknown[]).length = 0 }).toThrow(TypeError)
    expect(() => { delete asLoose(view)['title'] }).toThrow(TypeError)
    expect(() => { asLoose(view)['extra'] = 1 }).toThrow(TypeError)
  })

  it('freezes a copy, so the owner’s own draft stays editable', () => {
    const draft = createDefaultSite('house-a', NOW)
    const view = toReadonlySite(draft)
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(draft)).toBe(false)
    expect(Object.isFrozen(draft.projects)).toBe(false)

    draft.title = 'Still editable'
    expect(view.title).not.toBe('Still editable')
  })

  it('accepts something already read-only', () => {
    const once = toReadonlySite(createDefaultSite('house-a', NOW))
    expect(toReadonlySite(once)).toEqual(once)
  })

  it('is read-only to the compiler as well', () => {
    // Never called: these lines would throw at run time. They exist so the compiler
    // proves each assignment is an error.
    const compileTimeOnly = (view: ReadonlySiteContent): void => {
      // @ts-expect-error a visitor's view has no writable fields
      view.title = 'x'
      // @ts-expect-error nested fields are read-only too
      view.theme.text = '#000000'
      // @ts-expect-error lists cannot be changed
      view.projects.push({ id: 'x', title: 'X', description: '', url: null })
      // @ts-expect-error entries cannot be changed
      view.links[0]!.label = 'x'
    }
    expect(typeof compileTimeOnly).toBe('function')
  })
})

describe('the reader and the writer', () => {
  it('give visitors a reader that has no way to save', () => {
    expectTypeOf<keyof SiteReader>().toEqualTypeOf<'load'>()
    expectTypeOf<keyof SiteWriter>().toEqualTypeOf<'save'>()
    expectTypeOf<keyof SiteRepository>().toEqualTypeOf<'load' | 'save'>()
  })

  it('hands a reader only read-only data', () => {
    expectTypeOf<ReturnType<SiteReader['load']>>().resolves.toEqualTypeOf<ReadonlySiteContent>()
    expectTypeOf<Parameters<SiteWriter['save']>[0]>().toEqualTypeOf<SiteContent>()
  })

  it('lets the full repository stand in where only a reader is needed', () => {
    expectTypeOf<SiteRepository>().toExtend<SiteReader>()
    expectTypeOf<SiteReader>().not.toExtend<SiteWriter>()
  })

  it('works with a reader built from nothing but a load function', async () => {
    const reader: SiteReader = {
      load: async houseId => toReadonlySite(createDefaultSite(houseId, NOW)),
    }
    const site = await reader.load('house-b')
    expect(site.houseId).toBe('house-b')
    expect('save' in reader).toBe(false)
  })
})

describe('nextEntryId', () => {
  it('starts at 1 and counts up', () => {
    expect(nextEntryId([], 'project')).toBe('project-1')
    expect(nextEntryId([{ id: 'project-1' }], 'project')).toBe('project-2')
  })

  it('fills a gap rather than guessing, and never reuses a present id', () => {
    expect(nextEntryId([{ id: 'link-1' }, { id: 'link-3' }], 'link')).toBe('link-2')
    expect(nextEntryId([{ id: 'link-1' }, { id: 'link-2' }, { id: 'link-3' }], 'link')).toBe('link-4')
  })

  it('ignores ids from other lists and produces ids the validator accepts', () => {
    expect(nextEntryId([{ id: 'link-1' }], 'project')).toBe('project-1')
    expect(nextEntryId([], 'project')).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/)
  })
})
