/**
 * Friendly checks of hand-written HTML and CSS. Browsers forgive nearly
 * everything, so these only *warn*: they never stop a page being saved or shown.
 * Pure string scanning; nothing is parsed into a document or run.
 */

export interface CodeNote {
  line: number
  message: string
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr', 'basefont', 'bgsound', 'frame', 'keygen', 'image', 'isindex', 'nextid', 'command'])
// Elements whose closing tag HTML lets you leave out.
const OPTIONAL_END = new Set(['p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'option', 'optgroup',
  'rt', 'rp', 'colgroup', 'caption', 'html', 'head', 'body'])
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'plaintext'])
const MAX_NOTES = 50

/** Line numbers for positions that only move forward, so a whole page is scanned once. */
function lineCounter(text: string): (index: number) => number {
  let at = 0
  let line = 1
  return index => {
    for (; at < index && at < text.length; at++) if (text.charCodeAt(at) === 10) line++
    return line
  }
}

/** Likely mistakes in a page: tags closed that were never opened, or opened and never closed. */
export function checkHtml(source: string): CodeNote[] {
  const notes: CodeNote[] = []
  const stack: Array<{ name: string; line: number }> = []
  // Where something tag-like starts. The rest of each tag is scanned by hand,
  // once, so the check stays linear however broken the page is.
  const start = /<(!--|!|\?|\/?(?=[A-Za-z]))/g
  const tagName = /[A-Za-z][A-Za-z0-9-]*/y
  const lower = source.toLowerCase()
  const lineAt = lineCounter(source)
  let match: RegExpExecArray | null

  while ((match = start.exec(source)) && notes.length < MAX_NOTES) {
    const kind = match[1]!
    if (kind === '!--') {
      const end = source.indexOf('-->', start.lastIndex)
      if (end < 0) { notes.push({ line: lineAt(match.index), message: 'This comment is never closed with -->.' }); break }
      start.lastIndex = end + 3
      continue
    }
    if (kind === '!' || kind === '?') {
      // <!DOCTYPE …>, <![CDATA[…]]>, <?…>: nothing to check.
      const end = source.indexOf('>', start.lastIndex)
      if (end < 0) break
      start.lastIndex = end + 1
      continue
    }
    tagName.lastIndex = start.lastIndex
    const nameMatch = tagName.exec(source)
    if (!nameMatch) continue
    const name = nameMatch[0].toLowerCase()
    const line = lineAt(match.index)
    const end = tagEnd(source, tagName.lastIndex)
    if (end < 0) {
      // Everything after this point is inside the unfinished tag.
      notes.push({ line, message: `<${kind}${nameMatch[0]} is never finished with >.` })
      break
    }
    start.lastIndex = end + 1
    const closing = kind === '/'

    if (!closing) {
      if (VOID.has(name) || source.charCodeAt(end - 1) === 47 /* / */) continue
      if (RAW_TEXT.has(name)) {
        // Skip to the matching end tag; nothing inside is markup.
        const rawEnd = lower.indexOf(`</${name}`, start.lastIndex)
        if (rawEnd < 0) { notes.push({ line, message: `<${name}> is never closed.` }); break }
        start.lastIndex = rawEnd
        stack.push({ name, line })
        continue
      }
      // An open <p> or <li> ends when another of the same kind starts.
      if (OPTIONAL_END.has(name) && stack.length > 0 && stack[stack.length - 1]!.name === name) stack.pop()
      stack.push({ name, line })
      continue
    }

    if (VOID.has(name)) { notes.push({ line, message: `</${name}> is not needed: <${name}> has no closing tag.` }); continue }
    const at = findLast(stack, name)
    if (at < 0) {
      notes.push({ line, message: `</${name}> closes a tag that is not open.` })
      continue
    }
    for (let i = stack.length - 1; i > at; i--) {
      const open = stack[i]!
      if (!OPTIONAL_END.has(open.name)) {
        notes.push({ line: open.line, message: `<${open.name}> (line ${open.line}) is not closed before </${name}> on line ${line}.` })
      }
    }
    stack.length = at
  }

  for (const open of stack) {
    if (notes.length >= MAX_NOTES) break
    if (!OPTIONAL_END.has(open.name)) notes.push({ line: open.line, message: `<${open.name}> is never closed.` })
  }
  return notes.sort((a, b) => a.line - b.line)
}

/** The index of the `>` that ends a tag whose attributes start at `from`, or -1. Quoted values may contain `>`. */
function tagEnd(source: string, from: number): number {
  let afterEquals = false
  for (let i = from; i < source.length; i++) {
    const c = source[i]
    if (c === '>') return i
    if (c === '=') { afterEquals = true; continue }
    if (afterEquals && (c === '"' || c === "'")) {
      const close = source.indexOf(c, i + 1)
      if (close < 0) return -1
      i = close
    }
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r' && c !== '\f') afterEquals = false
  }
  return -1
}

function findLast(stack: ReadonlyArray<{ name: string }>, name: string): number {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.name === name) return i
  return -1
}

/** Unbalanced `{` `}` in a stylesheet, ignoring comments and strings. */
export function checkCss(source: string): CodeNote[] {
  const notes: CodeNote[] = []
  const open: number[] = []
  let line = 1
  for (let i = 0; i < source.length && notes.length < MAX_NOTES; i++) {
    const c = source[i]
    if (c === '\n') { line++; continue }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? source.length : end + 2
      for (let j = i; j < stop; j++) if (source[j] === '\n') line++
      if (end < 0) notes.push({ line, message: 'This comment is never closed with */.' })
      i = stop - 1
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (c === '{') open.push(line)
    else if (c === '}') {
      if (open.length === 0) notes.push({ line, message: 'This } has no matching {.' })
      else open.pop()
    }
  }
  for (const at of open) if (notes.length < MAX_NOTES) notes.push({ line: at, message: 'This { is never closed with }.' })
  return notes.sort((a, b) => a.line - b.line)
}
