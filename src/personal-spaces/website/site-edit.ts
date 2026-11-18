import { contrastRatio, formatContrastRatio, requiredContrast, type TextSize } from './contrast'
import { cloneSite, nextEntryId } from './site-readonly'
import {
  SITE_LIMITS,
  type ReadonlySiteContent,
  type SiteContent,
  type SiteLink,
  type SiteProject,
  type SiteTheme,
} from './site-types'
import { validateSite } from './site-validation'
import { THEME_PRESETS, themeFromPreset, type PresetId } from './theme-presets'

/**
 * The pure rules of editing a website: what changed, how lists and themes are
 * edited, how readable the colours are, and what the preview should show.
 *
 * Every function returns new data and leaves its input alone, so a draft can
 * never change the saved site it was copied from. No storage, no UI.
 */

// ── The draft ──────────────────────────────────────────────────────────────

/** An independent working copy. Changing it never touches the original. */
export function startDraft(site: SiteContent | ReadonlySiteContent): SiteContent {
  return cloneSite(site)
}

/** Compares the content a person edits. The save time is the store's business, not theirs. */
export function sitesEqual(a: SiteContent | ReadonlySiteContent, b: SiteContent | ReadonlySiteContent): boolean {
  return JSON.stringify({ ...cloneSite(a), updatedAt: '' }) === JSON.stringify({ ...cloneSite(b), updatedAt: '' })
}

/** True when the draft differs from the site it started as. */
export function isDirty(original: SiteContent | ReadonlySiteContent, draft: SiteContent): boolean {
  return !sitesEqual(original, draft)
}

// ── Lists ──────────────────────────────────────────────────────────────────

/** Why another entry cannot be added, or null when it can. Nothing is ever cut off silently. */
export function addBlockedReason(kind: 'project' | 'link', count: number): string | null {
  const max = kind === 'project' ? SITE_LIMITS.maxProjects : SITE_LIMITS.maxLinks
  return count >= max ? `You can have at most ${max} ${kind}s. Remove one to add another.` : null
}

export function addProject(draft: SiteContent): SiteContent {
  if (addBlockedReason('project', draft.projects.length) !== null) return draft
  const project: SiteProject = {
    id: nextEntryId(draft.projects, 'project'),
    title: '',
    description: '',
    url: null,
  }
  return { ...draft, projects: [...draft.projects, project] }
}

export function addLink(draft: SiteContent): SiteContent {
  if (addBlockedReason('link', draft.links.length) !== null) return draft
  const link: SiteLink = { id: nextEntryId(draft.links, 'link'), label: '', url: '' }
  return { ...draft, links: [...draft.links, link] }
}

const without = <T extends { id: string }>(list: readonly T[], id: string): T[] => list.filter(entry => entry.id !== id)

export const removeProject = (draft: SiteContent, id: string): SiteContent => ({ ...draft, projects: without(draft.projects, id) })
export const removeLink = (draft: SiteContent, id: string): SiteContent => ({ ...draft, links: without(draft.links, id) })

/** Moves an entry one place earlier (`-1`) or later (`1`). At either end it stays put. */
export function moveEntry<T extends { id: string }>(list: readonly T[], id: string, delta: -1 | 1): T[] {
  const from = list.findIndex(entry => entry.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [entry] = next.splice(from, 1)
  next.splice(to, 0, entry!)
  return next
}

export const moveProject = (draft: SiteContent, id: string, delta: -1 | 1): SiteContent => ({ ...draft, projects: moveEntry(draft.projects, id, delta) })
export const moveLink = (draft: SiteContent, id: string, delta: -1 | 1): SiteContent => ({ ...draft, links: moveEntry(draft.links, id, delta) })

// ── The look ───────────────────────────────────────────────────────────────

/** The theme fields a preset decides. "Under construction" is a separate switch. */
const LOOK_KEYS = ['background', 'text', 'link', 'headerBackground', 'headerText', 'font', 'pattern'] as const

/** The preset whose look the theme matches exactly, or `custom`. */
export function inferPreset(theme: SiteTheme): SiteTheme['preset'] {
  for (const id of Object.keys(THEME_PRESETS) as PresetId[]) {
    const preset = THEME_PRESETS[id]
    if (LOOK_KEYS.every(key => preset[key].toUpperCase() === String(theme[key]).toUpperCase())) return id
  }
  return 'custom'
}

/** Chooses a preset's whole look. The "under construction" switch is left as it was. */
export function applyPreset(draft: SiteContent, id: PresetId): SiteContent {
  return { ...draft, theme: { ...themeFromPreset(id), underConstruction: draft.theme.underConstruction } }
}

type LookKey = (typeof LOOK_KEYS)[number]

/**
 * Changes one colour, the font or the pattern. If the result happens to be a
 * preset's exact look, the theme says so; otherwise it is `custom`.
 */
export function setLook(draft: SiteContent, key: LookKey, value: string): SiteContent {
  const theme = { ...draft.theme, [key]: value } as SiteTheme
  return { ...draft, theme: { ...theme, preset: inferPreset(theme) } }
}

export const setUnderConstruction = (draft: SiteContent, on: boolean): SiteContent => ({
  ...draft,
  theme: { ...draft.theme, underConstruction: on },
})

/** One row of the readability readout. */
export interface ContrastRow {
  key: 'text' | 'link' | 'headerText'
  /** Words for the row: what is being compared. */
  label: string
  size: TextSize
  /** The ratio the pair needs for WCAG AA. */
  needed: number
  /** The ratio as text ("12.44:1"), or null when a colour is not a valid `#RRGGBB`. */
  ratio: string | null
  /** True or false once both colours are valid; null while one is not. */
  passes: boolean | null
}

/**
 * How readable the chosen colours are. Body text and links must reach 4.5:1
 * against the page; the banner title is large text and needs 3:1. Matches the
 * rule `validateSite` enforces, so what is shown here is what blocks a save.
 */
export function contrastRows(theme: Readonly<SiteTheme>): ContrastRow[] {
  const row = (
    key: ContrastRow['key'],
    label: string,
    foreground: string,
    background: string,
    size: TextSize,
  ): ContrastRow => {
    const ratio = contrastRatio(foreground, background)
    const needed = requiredContrast(size)
    return {
      key,
      label,
      size,
      needed,
      ratio: ratio === null ? null : formatContrastRatio(ratio),
      passes: ratio === null ? null : ratio >= needed,
    }
  }
  return [
    row('text', 'Text on the page', theme.text, theme.background, 'normal'),
    row('link', 'Links on the page', theme.link, theme.background, 'normal'),
    row('headerText', 'Title on the banner', theme.headerText, theme.headerBackground, 'large'),
  ]
}

// ── The preview ────────────────────────────────────────────────────────────

/**
 * What the preview should draw for a draft. When the draft is valid that is
 * exactly what would be saved (cleaned the same way), so the preview and the
 * visitor's page are identical for the same content. While the draft has
 * problems, the draft itself is drawn as it stands; the renderer copes with
 * unfinished text and refuses unsafe links and colours on its own.
 */
export function previewOf(draft: SiteContent): ReadonlySiteContent {
  const checked = validateSite(draft)
  return checked.ok ? checked.value : draft
}
