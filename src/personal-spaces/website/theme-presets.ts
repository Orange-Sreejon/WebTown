import type { SiteTheme, ThemePresetId } from './site-types'

/** A named look. `custom` is not a preset: it means "the owner chose these colours". */
export type PresetId = Exclude<ThemePresetId, 'custom'>

/**
 * Ready-made looks, each a full theme that meets WCAG AA (a test checks every
 * one). Plain data: copying one into a site gives the owner a starting point.
 */
export const THEME_PRESETS: Readonly<Record<PresetId, Readonly<SiteTheme>>> = {
  'classic-grey': {
    preset: 'classic-grey',
    background: '#C0C0C0',
    text: '#000000',
    link: '#0000EE',
    headerBackground: '#000080',
    headerText: '#FFFFFF',
    font: 'serif',
    pattern: 'plain',
    underConstruction: false,
  },
  starfield: {
    preset: 'starfield',
    background: '#000022',
    text: '#FFFFFF',
    link: '#66CCFF',
    headerBackground: '#000080',
    headerText: '#FFFF66',
    font: 'mono',
    pattern: 'stars',
    underConstruction: false,
  },
  pastel: {
    preset: 'pastel',
    background: '#FFF0F5',
    text: '#3A1F5C',
    link: '#B0006B',
    headerBackground: '#8B1A6B',
    headerText: '#FFFFFF',
    font: 'sans',
    pattern: 'dots',
    underConstruction: false,
  },
  forest: {
    preset: 'forest',
    background: '#F0FFF0',
    text: '#1B3A1B',
    link: '#0B5394',
    headerBackground: '#2E5E2E',
    headerText: '#FFFFFF',
    font: 'serif',
    pattern: 'grid',
    underConstruction: false,
  },
}

export const DEFAULT_PRESET_ID: PresetId = 'starfield'

/** A fresh copy of a preset, so callers can edit it without touching the shared table. */
export function themeFromPreset(id: PresetId): SiteTheme {
  return { ...THEME_PRESETS[id] }
}
