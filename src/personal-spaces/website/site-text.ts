/**
 * Plain-text handling for website content.
 *
 * Website text is plain text, stored and shown literally. These helpers only
 * clean it up. Characters such as < and & are ordinary and are never
 * interpreted, escaped or removed: `<script>` in a title is the eight characters
 * `<script>`, because the renderer shows every string as a React text node.
 * Pure string functions.
 */

// C0 and C1 control characters, except tab and line feed which are handled below.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g
const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g

/**
 * Cleans text for storage.
 *
 * - Removes control and invisible direction characters.
 * - Turns CRLF and CR into LF, and tabs into spaces.
 * - Single-line text: every run of whitespace becomes one space.
 * - Multi-line text: trailing spaces are dropped from each line, and more than
 *   one blank line in a row collapses to one (paragraphs are separated by
 *   one blank line).
 * - Trims both ends.
 */
export function normalizeText(input: string, multiline: boolean): string {
  const cleaned = input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL_CHARACTERS, '')
    .replace(ZERO_WIDTH, '')

  if (!multiline) return cleaned.replace(/\s+/g, ' ').trim()

  return cleaned
    .split('\n')
    .map(line => line.replace(/[ \u00a0]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Length in characters as a person counts them (an emoji is one, not two). */
export function textLength(text: string): number {
  return Array.from(text).length
}

/** Splits multi-line text into paragraphs on blank lines. Never returns an empty paragraph. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0)
}
