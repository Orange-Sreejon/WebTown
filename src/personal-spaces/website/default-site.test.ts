import { describe, expect, it } from 'vitest'
import { meetsAA } from './contrast'
import { createDefaultSite, defaultDisplayName } from './default-site'
import { SITE_PAGES, SECTION_IDS, SITE_LIMITS, THEME_PRESET_IDS, FONT_IDS, PATTERN_IDS } from './site-types'
import { splitParagraphs } from './site-text'
import { validateSite } from './site-validation'
import { DEFAULT_PRESET_ID, THEME_PRESETS, themeFromPreset, type PresetId } from './theme-presets'
import { validateExternalUrl } from './url-policy'

const NOW = '2026-11-16T12:00:00.000Z'
const PRESETS = Object.keys(THEME_PRESETS) as PresetId[]

describe('the default website', () => {
  it('passes its own validation, unchanged', () => {
    const site = createDefaultSite('house-a', NOW)
    const result = validateSite(site)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(site)
  })

  it('is valid for every house id the game uses', () => {
    for (const id of ['house-a', 'house-b', 'house-c', 'house-d', 'house-e', 'house-f', 'house-g']) {
      expect(validateSite(createDefaultSite(id, NOW)).ok, id).toBe(true)
    }
  })

  it('has content for all four pages', () => {
    const site = createDefaultSite('house-a', NOW)
    expect(site.title.length).toBeGreaterThan(0)
    expect(site.profile.displayName.length).toBeGreaterThan(0)
    expect(site.profile.tagline.length).toBeGreaterThan(0)
    expect(splitParagraphs(site.home.welcome).length).toBeGreaterThanOrEqual(2)
    expect(splitParagraphs(site.about.body).length).toBeGreaterThanOrEqual(2)
    expect(site.projects.length).toBeGreaterThanOrEqual(3)
    expect(site.links.length).toBeGreaterThanOrEqual(2)
    expect(SITE_PAGES.map(p => p.id)).toEqual([...SECTION_IDS])
  })

  it('names the house in the title and the profile', () => {
    const site = createDefaultSite('house-c', NOW)
    expect(site.title).toBe('Welcome to House C!')
    expect(site.profile.displayName).toBe('House C')
    expect(site.about.body).toContain('House C')
    expect(site.houseId).toBe('house-c')
  })

  it('uses the time it is given', () => {
    expect(createDefaultSite('house-a', '2030-01-02T03:04:05.000Z').updatedAt).toBe('2030-01-02T03:04:05.000Z')
  })

  it('stays well inside every limit, so an owner has room to write', () => {
    const site = createDefaultSite('house-a', NOW)
    expect(site.home.welcome.length).toBeLessThan(SITE_LIMITS.welcome.max / 2)
    expect(site.about.body.length).toBeLessThan(SITE_LIMITS.aboutBody.max / 2)
    expect(site.projects.length).toBeLessThan(SITE_LIMITS.maxProjects)
    expect(site.links.length).toBeLessThan(SITE_LIMITS.maxLinks)
  })

  it('only links to reserved example addresses, never to a real site', () => {
    const site = createDefaultSite('house-a', NOW)
    const urls = [...site.links.map(l => l.url), ...site.projects.map(p => p.url).filter((u): u is string => u !== null)]
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      const check = validateExternalUrl(url)
      expect(check.ok, url).toBe(true)
      if (check.ok) expect(check.hostname).toMatch(/^example\.(com|org|net)$/)
    }
  })

  it('has at least one project without a link, to show that links are optional', () => {
    expect(createDefaultSite('house-a', NOW).projects.some(p => p.url === null)).toBe(true)
  })

  it('has a theme that reads well, in the late-1990s style', () => {
    const { theme } = createDefaultSite('house-a', NOW)
    expect(theme.preset).toBe(DEFAULT_PRESET_ID)
    expect(theme.underConstruction).toBe(true)
    expect(meetsAA(theme.text, theme.background, 'normal')).toBe(true)
    expect(meetsAA(theme.link, theme.background, 'normal')).toBe(true)
    expect(meetsAA(theme.headerText, theme.headerBackground, 'large')).toBe(true)
  })

  it('returns a fresh object every time, so editing one never changes another', () => {
    const a = createDefaultSite('house-a', NOW)
    const b = createDefaultSite('house-a', NOW)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.projects).not.toBe(b.projects)
    expect(a.theme).not.toBe(b.theme)

    a.projects[0]!.title = 'Changed'
    a.theme.text = '#123456'
    a.links.length = 0
    const c = createDefaultSite('house-a', NOW)
    expect(c.projects[0]!.title).not.toBe('Changed')
    expect(c.theme.text).not.toBe('#123456')
    expect(c.links.length).toBeGreaterThan(0)
  })

  it('does not change the shared presets when its theme is edited', () => {
    const site = createDefaultSite('house-a', NOW)
    site.theme.text = '#123456'
    expect(THEME_PRESETS[DEFAULT_PRESET_ID].text).not.toBe('#123456')
  })
})

describe('defaultDisplayName', () => {
  it('words a house id as a name', () => {
    expect(defaultDisplayName('house-a')).toBe('House A')
    expect(defaultDisplayName('cottage')).toBe('Cottage')
    expect(defaultDisplayName('big-red-barn')).toBe('Big Red Barn')
  })

  it('has a fallback for an empty id', () => {
    expect(defaultDisplayName('')).toBe('Resident')
    expect(defaultDisplayName('--')).toBe('Resident')
  })
})

describe('theme presets', () => {
  it('has one preset for every named theme except custom', () => {
    expect([...PRESETS].sort()).toEqual(THEME_PRESET_IDS.filter(id => id !== 'custom').sort())
    expect(PRESETS).toContain(DEFAULT_PRESET_ID)
  })

  it.each(PRESETS)('%s is a complete theme that meets WCAG AA', id => {
    const theme = THEME_PRESETS[id]
    expect(theme.preset).toBe(id)
    expect(FONT_IDS).toContain(theme.font)
    expect(PATTERN_IDS).toContain(theme.pattern)
    expect(meetsAA(theme.text, theme.background, 'normal')).toBe(true)
    expect(meetsAA(theme.link, theme.background, 'normal')).toBe(true)
    expect(meetsAA(theme.headerText, theme.headerBackground, 'large')).toBe(true)

    const site = { ...createDefaultSite('house-a', NOW), theme: themeFromPreset(id) }
    expect(validateSite(site).ok).toBe(true)
  })

  it('gives each preset its own look', () => {
    const backgrounds = new Set(PRESETS.map(id => THEME_PRESETS[id].background))
    expect(backgrounds.size).toBe(PRESETS.length)
  })

  it('hands out copies', () => {
    const copy = themeFromPreset('forest')
    copy.text = '#000001'
    expect(THEME_PRESETS.forest.text).not.toBe('#000001')
    expect(themeFromPreset('forest')).toEqual(THEME_PRESETS.forest)
  })
})
