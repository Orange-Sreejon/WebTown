import type { CSSProperties } from 'react'
import { normalizeHexColour } from '../../personal-spaces/website/contrast'
import { THEME_PRESETS } from '../../personal-spaces/website/theme-presets'
import type { FontId, SiteTheme } from '../../personal-spaces/website/site-types'

/** The three font stacks a website may choose from. The choice is an id; no font name is ever taken from content. */
export const FONT_STACKS: Readonly<Record<FontId, string>> = {
  serif: 'Georgia, "Times New Roman", Times, serif',
  sans: 'Verdana, Geneva, Tahoma, sans-serif',
  mono: '"Courier New", Courier, monospace',
}

const FALLBACK = THEME_PRESETS['classic-grey']

/** A colour that is certain to be `#RRGGBB`: the stored one if it is, a safe default if not. */
function safeColour(value: string, fallback: string): string {
  return normalizeHexColour(value) ?? fallback
}

/**
 * The CSS custom properties that carry a website's look. The renderer's
 * stylesheet reads them; nothing else about the page's style comes from content.
 *
 * Content was validated when it was saved and when it was loaded. Colours and
 * the font choice are checked once more here, so even a record that somehow
 * slipped past cannot put anything but a `#RRGGBB` colour or one of three fonts
 * into a style.
 */
export function themeStyle(theme: SiteTheme | Readonly<SiteTheme>): CSSProperties {
  const font = (FONT_STACKS as Record<string, string | undefined>)[theme.font] ?? FONT_STACKS.serif
  const vars: Record<string, string> = {
    '--site-bg': safeColour(theme.background, FALLBACK.background),
    '--site-text': safeColour(theme.text, FALLBACK.text),
    '--site-link': safeColour(theme.link, FALLBACK.link),
    '--site-header-bg': safeColour(theme.headerBackground, FALLBACK.headerBackground),
    '--site-header-text': safeColour(theme.headerText, FALLBACK.headerText),
    '--site-font': font,
  }
  return vars as CSSProperties
}

const PATTERNS = ['plain', 'dots', 'grid', 'stars'] as const

/** The background pattern id for a `data-pattern` attribute; anything unknown is plain. */
export function patternOf(theme: Readonly<SiteTheme>): (typeof PATTERNS)[number] {
  return (PATTERNS as readonly string[]).includes(theme.pattern) ? theme.pattern : 'plain'
}
