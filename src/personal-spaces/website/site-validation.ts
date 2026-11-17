import {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  contrastRatio,
  formatContrastRatio,
  normalizeHexColour,
} from './contrast'
import { normalizeText, textLength } from './site-text'
import {
  FONT_IDS,
  HOUSE_ID_PATTERN,
  ITEM_ID_PATTERN,
  PATTERN_IDS,
  SITE_LIMITS,
  SITE_SCHEMA_VERSION,
  THEME_PRESET_IDS,
  type SiteContent,
  type SiteLink,
  type SiteProject,
  type SiteTheme,
} from './site-types'
import { validateExternalUrl } from './url-policy'

/** One thing wrong with a website, in words the owner can act on. */
export interface FieldError {
  /** Where it is, for the editor to highlight: `title`, `projects[1].url`, `theme.text`. */
  path: string
  message: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] }

type Dict = Record<string, unknown>

const isDict = (value: unknown): value is Dict =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Collects errors while a value is read, so one pass reports everything. */
class Reader {
  readonly errors: FieldError[] = []

  fail(path: string, message: string): void {
    this.errors.push({ path, message })
  }

  /** A required or optional piece of plain text, cleaned and length-checked. */
  text(
    value: unknown,
    path: string,
    label: string,
    limit: { min: number; max: number },
    multiline = false,
  ): string {
    if (value === undefined || value === null) {
      if (limit.min > 0) this.fail(path, `${label} is required.`)
      return ''
    }
    if (typeof value !== 'string') {
      this.fail(path, `${label} must be text.`)
      return ''
    }

    const text = normalizeText(value, multiline)
    if (text.length === 0) {
      if (limit.min > 0) this.fail(path, `${label} is required.`)
      return ''
    }
    const length = textLength(text)
    if (length > limit.max) {
      this.fail(path, `${label} is too long: ${length} characters, the limit is ${limit.max}.`)
    } else if (length < limit.min) {
      this.fail(path, `${label} is too short: it needs at least ${limit.min} characters.`)
    }
    return text
  }

  /** One of a fixed set of words. */
  choice<T extends string>(
    value: unknown,
    path: string,
    label: string,
    allowed: readonly T[],
    fallback: T,
  ): T {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
      return value as T
    }
    this.fail(path, `${label} must be one of: ${allowed.join(', ')}.`)
    return fallback
  }

  /** A `#RRGGBB` colour, normalised to upper case; empty string when invalid. */
  colour(value: unknown, path: string, label: string): string {
    const colour = normalizeHexColour(value)
    if (colour === null) {
      this.fail(path, `${label} must be a colour written as #RRGGBB, for example #FFCC00.`)
      return ''
    }
    return colour
  }

  /** A `https:` address, normalised; empty string when invalid. */
  url(value: unknown, path: string, label: string): string {
    const check = validateExternalUrl(value)
    if (!check.ok) {
      this.fail(path, `${label}: ${check.reason}`)
      return ''
    }
    return check.href
  }

  itemId(value: unknown, path: string, label: string, seen: Set<string>): string {
    if (typeof value !== 'string' || !ITEM_ID_PATTERN.test(value)) {
      this.fail(path, `${label} has a missing or invalid id.`)
      return ''
    }
    if (seen.has(value)) this.fail(path, `${label} shares an id with another entry.`)
    seen.add(value)
    return value
  }
}

function readProjects(reader: Reader, value: unknown): SiteProject[] {
  if (!Array.isArray(value)) {
    reader.fail('projects', 'The project list is missing or damaged.')
    return []
  }
  if (value.length > SITE_LIMITS.maxProjects) {
    const max = SITE_LIMITS.maxProjects
    reader.fail('projects', `Too many projects: ${value.length}, the limit is ${max}.`)
  }

  const seen = new Set<string>()
  return value.slice(0, SITE_LIMITS.maxProjects).map((entry: unknown, i): SiteProject => {
    const at = `projects[${i}]`
    const label = `Project ${i + 1}`
    if (!isDict(entry)) {
      reader.fail(at, `${label} is damaged.`)
      return { id: '', title: '', description: '', url: null }
    }
    const rawUrl = entry['url']
    const blank = rawUrl === undefined || rawUrl === null || (typeof rawUrl === 'string' && rawUrl.trim() === '')
    const hasUrl = !blank
    return {
      id: reader.itemId(entry['id'], `${at}.id`, label, seen),
      title: reader.text(entry['title'], `${at}.title`, `${label} title`, SITE_LIMITS.projectTitle),
      description: reader.text(
        entry['description'], `${at}.description`, `${label} description`,
        SITE_LIMITS.projectDescription, true,
      ),
      url: hasUrl ? reader.url(rawUrl, `${at}.url`, `${label} link`) : null,
    }
  })
}

function readLinks(reader: Reader, value: unknown): SiteLink[] {
  if (!Array.isArray(value)) {
    reader.fail('links', 'The link list is missing or damaged.')
    return []
  }
  if (value.length > SITE_LIMITS.maxLinks) {
    reader.fail('links', `Too many links: ${value.length}, the limit is ${SITE_LIMITS.maxLinks}.`)
  }

  const seen = new Set<string>()
  return value.slice(0, SITE_LIMITS.maxLinks).map((entry: unknown, i): SiteLink => {
    const at = `links[${i}]`
    const label = `Link ${i + 1}`
    if (!isDict(entry)) {
      reader.fail(at, `${label} is damaged.`)
      return { id: '', label: '', url: '' }
    }
    return {
      id: reader.itemId(entry['id'], `${at}.id`, label, seen),
      label: reader.text(entry['label'], `${at}.label`, `${label} name`, SITE_LIMITS.linkLabel),
      url: reader.url(entry['url'], `${at}.url`, `${label} address`),
    }
  })
}

/** Checks one text/background pair against a threshold and reports a readable failure. */
function checkContrast(
  reader: Reader,
  path: string,
  what: string,
  foreground: string,
  background: string,
  needed: number,
): void {
  if (foreground === '' || background === '') return // the colour itself was already reported
  const ratio = contrastRatio(foreground, background)
  if (ratio !== null && ratio < needed) {
    reader.fail(
      path,
      `${what} is too hard to read against its background: ` +
        `contrast ${formatContrastRatio(ratio)}, needs at least ${needed}:1.`,
    )
  }
}

function readTheme(reader: Reader, value: unknown): SiteTheme {
  const fallback: SiteTheme = {
    preset: 'custom', background: '', text: '', link: '', headerBackground: '', headerText: '',
    font: 'serif', pattern: 'plain', underConstruction: false,
  }
  if (!isDict(value)) {
    reader.fail('theme', 'The appearance settings are missing or damaged.')
    return fallback
  }

  const theme: SiteTheme = {
    preset: reader.choice(value['preset'], 'theme.preset', 'Theme', THEME_PRESET_IDS, 'custom'),
    background: reader.colour(value['background'], 'theme.background', 'Background colour'),
    text: reader.colour(value['text'], 'theme.text', 'Text colour'),
    link: reader.colour(value['link'], 'theme.link', 'Link colour'),
    headerBackground: reader.colour(
      value['headerBackground'], 'theme.headerBackground', 'Banner colour',
    ),
    headerText: reader.colour(value['headerText'], 'theme.headerText', 'Banner text colour'),
    font: reader.choice(value['font'], 'theme.font', 'Font', FONT_IDS, 'serif'),
    pattern: reader.choice(
      value['pattern'], 'theme.pattern', 'Background pattern', PATTERN_IDS, 'plain',
    ),
    underConstruction: false,
  }

  if (typeof value['underConstruction'] === 'boolean') {
    theme.underConstruction = value['underConstruction']
  } else {
    reader.fail('theme.underConstruction', 'The "under construction" setting must be on or off.')
  }

  // Body text and links are normal-size text (4.5:1). The banner title is large (3:1).
  checkContrast(reader, 'theme.text', 'Text colour', theme.text, theme.background, AA_NORMAL_TEXT)
  checkContrast(reader, 'theme.link', 'Link colour', theme.link, theme.background, AA_NORMAL_TEXT)
  checkContrast(
    reader, 'theme.headerText', 'Banner text colour',
    theme.headerText, theme.headerBackground, AA_LARGE_TEXT,
  )
  return theme
}

/**
 * Checks and cleans website data of unknown origin (the editor's draft, or a
 * stored record) and returns a fresh `SiteContent` built only from known
 * fields. It never mutates its input, and nothing in the result is shared with
 * it, so unknown or hostile extra properties simply do not survive.
 *
 * Every problem is reported at once, each with a path and a plain sentence.
 * On success, text is cleaned, colours are upper case and links are normalised.
 */
export function validateSite(input: unknown): ValidationResult<SiteContent> {
  const reader = new Reader()

  if (!isDict(input)) {
    reader.fail('', 'The website data is missing or damaged.')
    return { ok: false, errors: reader.errors }
  }

  if (input['schemaVersion'] !== SITE_SCHEMA_VERSION) {
    reader.fail('schemaVersion', 'This website was saved by a different version of WebTown.')
  }

  const houseId = input['houseId']
  if (typeof houseId !== 'string' || !HOUSE_ID_PATTERN.test(houseId)) {
    reader.fail('houseId', 'The website is not attached to a valid house.')
  }

  const updatedAt = input['updatedAt']
  if (typeof updatedAt !== 'string' || !isIsoUtc(updatedAt)) {
    reader.fail('updatedAt', 'The "last updated" time is missing or not a valid date.')
  }

  const profile = isDict(input['profile']) ? input['profile'] : {}
  if (!isDict(input['profile'])) reader.fail('profile', 'The profile is missing or damaged.')
  const home = isDict(input['home']) ? input['home'] : {}
  if (!isDict(input['home'])) reader.fail('home', 'The Home page is missing or damaged.')
  const about = isDict(input['about']) ? input['about'] : {}
  if (!isDict(input['about'])) reader.fail('about', 'The About page is missing or damaged.')

  const value: SiteContent = {
    schemaVersion: SITE_SCHEMA_VERSION,
    houseId: typeof houseId === 'string' ? houseId : '',
    updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
    title: reader.text(input['title'], 'title', 'The site title', SITE_LIMITS.title),
    profile: {
      displayName: reader.text(
        profile['displayName'], 'profile.displayName', 'Your name', SITE_LIMITS.displayName,
      ),
      tagline: reader.text(
        profile['tagline'], 'profile.tagline', 'The tagline', SITE_LIMITS.tagline,
      ),
    },
    home: {
      welcome: reader.text(
        home['welcome'], 'home.welcome', 'The welcome message', SITE_LIMITS.welcome, true,
      ),
    },
    about: {
      body: reader.text(about['body'], 'about.body', 'The About text', SITE_LIMITS.aboutBody, true),
    },
    projects: readProjects(reader, input['projects']),
    links: readLinks(reader, input['links']),
    theme: readTheme(reader, input['theme']),
  }

  return reader.errors.length === 0 ? { ok: true, value } : { ok: false, errors: reader.errors }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/** `2026-11-16T12:00:00.000Z` style, and a real date (no month 13). */
export function isIsoUtc(value: string): boolean {
  if (!ISO_UTC.test(value)) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10)
}

/** The messages only, for a simple list. */
export function errorMessages(errors: readonly FieldError[]): string[] {
  return errors.map(error => error.message)
}
