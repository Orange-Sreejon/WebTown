/**
 * The personal website's data model.
 *
 * Pure data: plain strings, numbers and booleans, nothing else. There is no
 * field that holds HTML, markup, CSS or script, so user content can only ever
 * be shown as text. This module has no dependency on Phaser, React,
 * IndexedDB or any backend, and every other website module builds on it.
 */

/** Written into every stored site so a later version can migrate old data. */
export const SITE_SCHEMA_VERSION = 1

// ── Pages ──────────────────────────────────────────────────────────────────

export const SECTION_IDS = ['home', 'about', 'projects', 'links'] as const

/** The four pages of a website. A closed set: navigation can never go anywhere else. */
export type SectionId = (typeof SECTION_IDS)[number]

export interface SitePage {
  id: SectionId
  /** The navigation label. */
  label: string
}

export const SITE_PAGES: readonly SitePage[] = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'projects', label: 'Projects' },
  { id: 'links', label: 'Links' },
]

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && (SECTION_IDS as readonly string[]).includes(value)
}

// ── Theme choices ──────────────────────────────────────────────────────────

export const THEME_PRESET_IDS = ['classic-grey', 'starfield', 'pastel', 'forest', 'custom'] as const
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number]

/** Fixed font stacks; the renderer maps each id to a stack. User CSS is never accepted. */
export const FONT_IDS = ['serif', 'sans', 'mono'] as const
export type FontId = (typeof FONT_IDS)[number]

/** Decorative page backgrounds, drawn with CSS by the renderer. */
export const PATTERN_IDS = ['plain', 'dots', 'grid', 'stars'] as const
export type PatternId = (typeof PATTERN_IDS)[number]

// ── Content ────────────────────────────────────────────────────────────────

export interface SiteProfile {
  /** The resident's name as shown on the page. Required. */
  displayName: string
  /** A short line under the title. May be empty. */
  tagline: string
}

export interface SiteProject {
  /** Unique within the site's projects. */
  id: string
  title: string
  /** Plain text. May be empty. */
  description: string
  /** An HTTPS address, or null for a project with no link. */
  url: string | null
}

export interface SiteLink {
  /** Unique within the site's links. */
  id: string
  label: string
  /** An HTTPS address. Required. */
  url: string
}

/** Colours are `#RRGGBB`, upper case. */
export interface SiteTheme {
  preset: ThemePresetId
  background: string
  text: string
  link: string
  /** The banner behind the site title. */
  headerBackground: string
  headerText: string
  font: FontId
  pattern: PatternId
  /** Shows the classic "under construction" banner. */
  underConstruction: boolean
}

export interface SiteContent {
  schemaVersion: typeof SITE_SCHEMA_VERSION
  /** The house this site belongs to. Never changes. */
  houseId: string
  /** ISO 8601 UTC, for example `2026-11-16T12:00:00.000Z`. */
  updatedAt: string
  title: string
  profile: SiteProfile
  home: { welcome: string }
  about: { body: string }
  projects: SiteProject[]
  links: SiteLink[]
  theme: SiteTheme
}

// ── Limits ─────────────────────────────────────────────────────────────────

/** Counted in characters (code points), after whitespace and control characters are normalised. */
export const SITE_LIMITS = {
  title: { min: 1, max: 60 },
  displayName: { min: 1, max: 40 },
  tagline: { min: 0, max: 120 },
  welcome: { min: 1, max: 2000 },
  aboutBody: { min: 0, max: 4000 },
  projectTitle: { min: 1, max: 60 },
  projectDescription: { min: 0, max: 500 },
  linkLabel: { min: 1, max: 60 },
  maxProjects: 12,
  maxLinks: 20,
  maxUrlLength: 2048,
} as const

/** House ids and item ids are simple slugs, like the ids in `ownership.ts`. */
export const HOUSE_ID_PATTERN = /^[a-z0-9-]{1,40}$/
export const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/

// ── Read-only view ─────────────────────────────────────────────────────────

/** Recursively read-only. What a visitor is handed: data it can show but not change. */
export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T

export type ReadonlySiteContent = DeepReadonly<SiteContent>
