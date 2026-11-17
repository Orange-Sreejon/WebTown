import { describe, expect, it } from 'vitest'
import { normalizeText, splitParagraphs, textLength } from './site-text'

describe('normalizeText', () => {
  it('trims and keeps ordinary text', () => {
    expect(normalizeText('  Hello, WebTown!  ', false)).toBe('Hello, WebTown!')
  })

  it('collapses single-line whitespace, including line breaks', () => {
    expect(normalizeText('a   b\t\tc\n\nd\r\ne', false)).toBe('a b c d e')
  })

  it('removes control characters but keeps line feeds in multi-line text', () => {
    expect(normalizeText('a\u0000b\u0007c\u001bd\u007fe', false)).toBe('abcde')
    expect(normalizeText('one\u0000\ntwo', true)).toBe('one\ntwo')
  })

  it('removes invisible direction and zero-width characters', () => {
    expect(normalizeText('a\u202Eb\u200Bc\uFEFFd', false)).toBe('abcd')
  })

  it('turns CRLF and CR into LF and tabs into spaces in multi-line text', () => {
    expect(normalizeText('a\r\nb\rc\td', true)).toBe('a\nb\nc d')
  })

  it('keeps one blank line between paragraphs and collapses more', () => {
    expect(normalizeText('a\n\nb', true)).toBe('a\n\nb')
    expect(normalizeText('a\n\n\n\n\nb', true)).toBe('a\n\nb')
  })

  it('drops trailing spaces on each line and trims the ends', () => {
    expect(normalizeText('\n\n  a   \n b  \n\n', true)).toBe('a\n b')
  })

  it('is idempotent', () => {
    for (const text of ['  a \n\n\n b\t', 'x\u0000y', 'p1\r\n\r\n\r\np2']) {
      for (const multiline of [true, false]) {
        const once = normalizeText(text, multiline)
        expect(normalizeText(once, multiline)).toBe(once)
      }
    }
  })

  it('composes accents so the same word has one length', () => {
    expect(normalizeText('e\u0301', false)).toBe('\u00e9')
  })
})

describe('literal text', () => {
  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<b>bold</b> & <i>italic</i>',
    '<a href="javascript:alert(1)">x</a>',
    '<!-- comment -->',
    '&lt;script&gt; &amp; &#60;b&#62;',
    '"quotes" and \'apostrophes\' and `backticks`',
    '3 < 5 and 7 > 2, a <- b, I <3 WebTown',
  ])('is kept character for character: %s', text => {
    expect(normalizeText(text, false)).toBe(text)
    expect(normalizeText(text, true)).toBe(text)
  })

  it('does not decode or encode entities', () => {
    expect(normalizeText('&lt;b&gt;', false)).toBe('&lt;b&gt;')
    expect(normalizeText('<b>', false)).not.toBe('&lt;b&gt;')
  })
})
describe('textLength', () => {
  it('counts characters as people do', () => {
    expect(textLength('abc')).toBe(3)
    expect(textLength('😀😀')).toBe(2)
    expect(textLength('')).toBe(0)
    expect(textLength('é')).toBe(1)
  })
})

describe('splitParagraphs', () => {
  it('splits on blank lines and drops empties', () => {
    expect(splitParagraphs('one\n\ntwo\n\n\nthree')).toEqual(['one', 'two', 'three'])
    expect(splitParagraphs('single\nline break stays')).toEqual(['single\nline break stays'])
    expect(splitParagraphs('')).toEqual([])
  })
})
