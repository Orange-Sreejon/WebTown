import { describe, expect, it } from 'vitest'
import { createDefaultSite } from './default-site'
import {
  addBlockedReason,
  addLink,
  addProject,
  applyPreset,
  contrastRows,
  inferPreset,
  isDirty,
  moveEntry,
  moveLink,
  moveProject,
  previewOf,
  removeLink,
  removeProject,
  setLook,
  setUnderConstruction,
  sitesEqual,
  startDraft,
} from './site-edit'
import { toReadonlySite } from './site-readonly'
import { SITE_LIMITS, type SiteContent } from './site-types'
import { validateSite } from './site-validation'
import { THEME_PRESETS } from './theme-presets'

const site = (): SiteContent => createDefaultSite('house-a', '2026-11-16T12:00:00.000Z')

describe('the draft', () => {
  it('is an independent copy of the site it started from', () => {
    const original = site()
    const draft = startDraft(original)
    expect(draft).toEqual(original)

    draft.title = 'Changed'
    draft.profile.displayName = 'Changed'
    draft.projects[0]!.title = 'Changed'
    draft.projects.push({ id: 'x', title: 'X', description: '', url: null })
    draft.links.length = 0
    draft.theme.text = '#123456'

    expect(original).toEqual(site())
  })

  it('can start from a read-only site, and the draft is editable', () => {
    const draft = startDraft(toReadonlySite(site()))
    draft.title = 'Editable'
    expect(draft.title).toBe('Editable')
    expect(Object.isFrozen(draft)).toBe(false)
  })

  it('is clean until something changes, and clean again when the change is undone', () => {
    const original = site()
    const draft = startDraft(original)
    expect(isDirty(original, draft)).toBe(false)

    draft.title = 'New title'
    expect(isDirty(original, draft)).toBe(true)

    draft.title = original.title
    expect(isDirty(original, draft)).toBe(false)
  })

  it.each([
    ['a project', (d: SiteContent) => { d.projects[1]!.description = 'x' }],
    ['a link address', (d: SiteContent) => { d.links[0]!.url = 'https://example.net/' }],
    ['the order of the links', (d: SiteContent) => { d.links.reverse() }],
    ['a colour', (d: SiteContent) => { d.theme.link = '#FFFFFF' }],
    ['the pattern', (d: SiteContent) => { d.theme.pattern = 'plain' }],
    ['the banner switch', (d: SiteContent) => { d.theme.underConstruction = false }],
    ['the about text', (d: SiteContent) => { d.about.body += ' ' }],
  ])('notices a change to %s', (_name, change) => {
    const original = site()
    const draft = startDraft(original)
    change(draft)
    expect(isDirty(original, draft)).toBe(true)
  })

  it('does not count the save time as an edit', () => {
    const original = site()
    expect(sitesEqual(original, { ...site(), updatedAt: '2030-01-01T00:00:00.000Z' })).toBe(true)
  })
})

describe('projects and links', () => {
  it('adds an empty project with a fresh id, at the end', () => {
    const next = addProject(site())
    expect(next.projects).toHaveLength(4)
    expect(next.projects[3]).toEqual({ id: 'project-4', title: '', description: '', url: null })
  })

  it('adds an empty link with a fresh id, at the end', () => {
    const next = addLink(site())
    expect(next.links[2]).toEqual({ id: 'link-3', label: '', url: '' })
  })

  it('never reuses an id that is still in the list', () => {
    let draft = site()
    draft = removeProject(draft, 'project-1')
    draft = addProject(draft)
    const ids = draft.projects.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('refuses to add past the limits, and says why, instead of dropping anything', () => {
    let draft = site()
    while (draft.projects.length < SITE_LIMITS.maxProjects) draft = addProject(draft)
    expect(draft.projects).toHaveLength(12)
    expect(addProject(draft)).toBe(draft)
    expect(addBlockedReason('project', 12)).toBe('You can have at most 12 projects. Remove one to add another.')
    expect(addBlockedReason('project', 11)).toBeNull()

    while (draft.links.length < SITE_LIMITS.maxLinks) draft = addLink(draft)
    expect(addLink(draft)).toBe(draft)
    expect(addBlockedReason('link', 20)).toContain('at most 20 links')
    expect(addBlockedReason('link', 2)).toBeNull()
  })

  it('removes the entry with that id and no other', () => {
    expect(removeProject(site(), 'project-2').projects.map(p => p.id)).toEqual(['project-1', 'project-3'])
    expect(removeLink(site(), 'link-1').links.map(l => l.id)).toEqual(['link-2'])
    expect(removeProject(site(), 'nope').projects).toHaveLength(3)
  })

  it('moves an entry one place earlier or later, and stops at the ends', () => {
    expect(moveProject(site(), 'project-3', -1).projects.map(p => p.id)).toEqual(['project-1', 'project-3', 'project-2'])
    expect(moveProject(site(), 'project-1', 1).projects.map(p => p.id)).toEqual(['project-2', 'project-1', 'project-3'])
    expect(moveProject(site(), 'project-1', -1).projects.map(p => p.id)).toEqual(['project-1', 'project-2', 'project-3'])
    expect(moveProject(site(), 'project-3', 1).projects.map(p => p.id)).toEqual(['project-1', 'project-2', 'project-3'])
    expect(moveLink(site(), 'link-2', -1).links.map(l => l.id)).toEqual(['link-2', 'link-1'])
    expect(moveEntry([{ id: 'a' }], 'zzz', 1)).toEqual([{ id: 'a' }])
  })

  it('does not change the draft it was given', () => {
    const draft = site()
    const snapshot = JSON.stringify(draft)
    addProject(draft); addLink(draft); removeProject(draft, 'project-1'); removeLink(draft, 'link-1')
    moveProject(draft, 'project-1', 1); moveLink(draft, 'link-1', 1)
    setLook(draft, 'text', '#000000'); applyPreset(draft, 'forest'); setUnderConstruction(draft, false)
    expect(JSON.stringify(draft)).toBe(snapshot)
  })

  it('keeps the entries it moves intact', () => {
    const draft = site()
    const moved = moveProject(draft, 'project-1', 1)
    expect(moved.projects.find(p => p.id === 'project-1')).toEqual(draft.projects[0])
  })
})

describe('the look', () => {
  it('applies a preset’s whole look, keeping the "under construction" switch', () => {
    const draft = setUnderConstruction(site(), true)
    const next = applyPreset(draft, 'forest')
    expect(next.theme).toEqual({ ...THEME_PRESETS.forest, underConstruction: true })
    expect(applyPreset(setUnderConstruction(site(), false), 'pastel').theme.underConstruction).toBe(false)
  })

  it('hands out a copy of the preset, never the shared one', () => {
    const next = applyPreset(site(), 'forest')
    next.theme.text = '#123456'
    expect(THEME_PRESETS.forest.text).not.toBe('#123456')
  })

  it('becomes custom when one colour is changed', () => {
    const next = setLook(applyPreset(site(), 'forest'), 'link', '#000000')
    expect(next.theme.preset).toBe('custom')
    expect(next.theme.link).toBe('#000000')
    expect(next.theme.background).toBe(THEME_PRESETS.forest.background)
  })

  it('becomes custom when the font or pattern is changed', () => {
    expect(setLook(applyPreset(site(), 'forest'), 'font', 'mono').theme.preset).toBe('custom')
    expect(setLook(applyPreset(site(), 'forest'), 'pattern', 'stars').theme.preset).toBe('custom')
  })

  it('goes back to the preset when the changes are undone', () => {
    const custom = setLook(applyPreset(site(), 'forest'), 'link', '#000000')
    const back = setLook(custom, 'link', THEME_PRESETS.forest.link)
    expect(back.theme.preset).toBe('forest')
  })

  it('recognises a preset whatever the case of the colours', () => {
    const next = setLook(applyPreset(site(), 'forest'), 'text', THEME_PRESETS.forest.text.toLowerCase())
    expect(next.theme.preset).toBe('forest')
    expect(inferPreset({ ...THEME_PRESETS.pastel })).toBe('pastel')
  })

  it('switches the banner on and off', () => {
    expect(setUnderConstruction(site(), false).theme.underConstruction).toBe(false)
    expect(setUnderConstruction(site(), true).theme.underConstruction).toBe(true)
  })

  it('keeps unfinished typing as typed, so the person is not corrected mid-word', () => {
    expect(setLook(site(), 'text', '#12').theme.text).toBe('#12')
  })
})

describe('contrast readout', () => {
  const withColours = (bg: string, text: string, link: string, hbg: string, htext: string): SiteContent => {
    let draft = site()
    for (const [key, value] of [['background', bg], ['text', text], ['link', link], ['headerBackground', hbg], ['headerText', htext]] as const) {
      draft = setLook(draft, key, value)
    }
    return draft
  }

  it('gives three rows: text, links and the banner title', () => {
    const rows = contrastRows(site().theme)
    expect(rows.map(r => r.key)).toEqual(['text', 'link', 'headerText'])
    expect(rows.map(r => r.needed)).toEqual([4.5, 4.5, 3])
    expect(rows.map(r => r.size)).toEqual(['normal', 'normal', 'large'])
  })

  it('shows the ratio and whether it passes', () => {
    const rows = contrastRows(withColours('#FFFFFF', '#000000', '#0000EE', '#000080', '#FFFFFF').theme)
    expect(rows[0]).toMatchObject({ ratio: '21.00:1', passes: true })
    expect(rows[2]).toMatchObject({ ratio: '16.00:1', passes: true })
  })

  it('passes just above each threshold and fails just below it', () => {
    const pass = contrastRows(withColours('#FFFFFF', '#767676', '#767676', '#FFFFFF', '#949494').theme)
    expect(pass.map(r => r.passes)).toEqual([true, true, true]) // 4.54, 4.54, 3.03
    const fail = contrastRows(withColours('#FFFFFF', '#777777', '#777777', '#FFFFFF', '#959595').theme)
    expect(fail.map(r => r.passes)).toEqual([false, false, false]) // 4.47, 4.47, 2.99
    expect(fail[0]!.ratio).toBe('4.47:1')
    expect(fail[2]!.ratio).toBe('2.99:1')
  })

  it('treats the banner as large text, so it can pass at a ratio body text could not', () => {
    const rows = contrastRows(withColours('#FFFFFF', '#000000', '#000000', '#FFFFFF', '#949494').theme)
    expect(rows[2]!.passes).toBe(true)
    expect(rows[2]!.ratio).toBe('3.03:1')
  })

  it('says nothing about a pair while a colour is not valid yet', () => {
    const rows = contrastRows(withColours('#FFFFFF', '#12', 'red', '#FFFFFF', '#000000').theme)
    expect(rows[0]).toMatchObject({ ratio: null, passes: null })
    expect(rows[1]).toMatchObject({ ratio: null, passes: null })
    expect(rows[2]!.passes).toBe(true)
  })

  it('agrees with the save rule: a failing row is exactly what validation refuses', () => {
    for (const [text, fails] of [['#767676', false], ['#777777', true]] as const) {
      const draft = withColours('#FFFFFF', text, '#0000EE', '#000080', '#FFFFFF')
      const rows = contrastRows(draft.theme)
      const errors = validateSite(draft)
      expect(rows[0]!.passes === false).toBe(fails)
      expect(!errors.ok && errors.errors.some(e => e.path === 'theme.text')).toBe(fails)
    }
  })

  it('shows every preset as passing', () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(contrastRows(preset).every(r => r.passes === true), preset.preset).toBe(true)
    }
  })
})

describe('the preview', () => {
  it('draws exactly what would be saved when the draft is valid', () => {
    const draft = site()
    draft.title = '  Padded\u0000 title  '
    draft.theme.background = '#000022'
    draft.theme.text = '#ffffff'
    const checked = validateSite(draft)
    expect(checked.ok).toBe(true)
    expect(previewOf(draft)).toEqual(checked.ok ? checked.value : null)
    expect(previewOf(draft).title).toBe('Padded title')
  })

  it('draws the draft as it stands while it still has problems', () => {
    const draft = site()
    draft.title = ''
    draft.links[0]!.url = 'http://example.com'
    expect(previewOf(draft)).toBe(draft)
  })

  it('does not change the draft', () => {
    const draft = site()
    draft.title = '  padded  '
    previewOf(draft)
    expect(draft.title).toBe('  padded  ')
  })
})
