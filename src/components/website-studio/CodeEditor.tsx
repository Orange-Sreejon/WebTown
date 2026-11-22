import { indentSelection, indentWithTab } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { ChangeSet, Compartment, EditorSelection, EditorState, type ChangeSpec, type Extension, type Transaction } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import { EditorView, basicSetup } from 'codemirror'
import { useEffect, useImperativeHandle, useRef } from 'react'
import { checkCss, checkHtml } from '../../personal-spaces/site-project/html-check'
import type { CodeEditorProps, StudioTheme } from './editor-types'

/**
 * The Studio's code editor: CodeMirror 6. This is the only file that imports CodeMirror, and it is only reached
 * from the owner's lazily loaded Studio, so visitors never download it.
 *
 * From CodeMirror's own packages (not re-implemented here):
 * - `basicSetup`: line numbers, undo, bracket matching, closing brackets and quotes, autocompletion with keyboard
 *   navigation (arrows, Enter, Escape, Ctrl+Space), search, re-indenting on input, Enter keeping the indentation;
 * - `html()` / `css()`: highlighting, contextual tag, attribute, property and value completion, and closing tags
 *   as you type `>` or `</`;
 * - `indentWithTab`: Tab and Shift+Tab indent and unindent the line or every selected line, and keep focus in the
 *   editor. To move focus out with the keyboard, press Escape and then Tab (CodeMirror's standard way out).
 *
 * Added here: Format (Shift+Alt+F, or the Studio's Format button), warnings in the editor from WebTown's markup
 * check, and the light or dark theme. Each document keeps its own undo history while the Studio is open.
 */
export function CodeEditor({ docKey, value, language, onChange, label, theme = 'light', ref }: CodeEditorProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const states = useRef(new Map<string, EditorState>())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const currentKey = useRef(docKey)
  const themeSlot = useRef(new Compartment())
  const themeRef = useRef(theme)
  themeRef.current = theme

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const view = viewRef.current
      if (!view) return
      view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true })
      view.focus()
    },
    focus() {
      viewRef.current?.focus()
    },
    format() {
      const view = viewRef.current
      if (!view) return
      formatDocument(view)
      view.focus()
    },
  }), [])

  const extensions = (lang: 'html' | 'css'): Extension[] => [
    basicSetup,
    keymap.of([indentWithTab, { key: 'Shift-Alt-f', run: view => { formatDocument(view); return true } }]),
    lang === 'html' ? html() : css(),
    markupWarnings(lang),
    lintGutter(),
    themeSlot.current.of(themeExtension(themeRef.current)),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': label }),
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChangeRef.current(update.state.doc.toString())
    }),
  ]

  // One view for the component's life; documents are swapped in and out of it.
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({ doc: value, extensions: extensions(language) }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switching documents: keep the old one's state (and undo history), restore or create the new one.
  useEffect(() => {
    const view = viewRef.current
    if (!view || currentKey.current === docKey) return
    states.current.set(currentKey.current, view.state)
    currentKey.current = docKey
    const kept = states.current.get(docKey)
    view.setState(kept && kept.doc.toString() === value ? kept : EditorState.create({ doc: value, extensions: extensions(language) }))
    // A kept document may have been put away under the other theme.
    view.dispatch({ effects: themeSlot.current.reconfigure(themeExtension(themeRef.current)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // A change from outside (Start over, Reload): replace the text, as one undoable step.
  useEffect(() => {
    const view = viewRef.current
    if (!view || currentKey.current !== docKey) return
    const current = view.state.doc.toString()
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value, docKey])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeSlot.current.reconfigure(themeExtension(theme)) })
  }, [theme])

  return (
    <div
      ref={hostRef}
      className="ws-code"
      data-theme={theme}
      onKeyDown={event => {
        // Escape belongs to the editor here (it is how you leave it with the keyboard), so it must not close the window.
        if (event.key === 'Escape') event.preventDefault()
      }}
    />
  )
}

/** One Dark for the dark theme; the light theme is CodeMirror's default look. */
function themeExtension(theme: StudioTheme): Extension {
  return theme === 'dark' ? oneDark : []
}

/** WebTown's markup check (the same one as the Markup check panel), as warnings on the lines they are about. */
function markupWarnings(lang: 'html' | 'css'): Extension {
  return linter(view => {
    const doc = view.state.doc
    const notes = lang === 'html' ? checkHtml(doc.toString()) : checkCss(doc.toString())
    return notes.map((note): Diagnostic => {
      const line = doc.line(Math.min(Math.max(1, note.line), doc.lines))
      return { from: line.from, to: line.to, severity: 'warning', source: 'Markup check', message: note.message }
    })
  }, { delay: 600 })
}

/**
 * Format: every line indented by the language's own rules (CodeMirror's `indentSelection`), trailing spaces
 * removed, as one undoable step. Lines inside `<pre>` and `<textarea>` are left exactly as they are, because there
 * the spaces are part of what the page shows. It does not split or join lines.
 */
export function formatDocument(view: EditorView): boolean {
  const state = view.state
  const text = state.doc.toString()
  const protectedLine = protectedLines(state, text)

  // 1. Trailing spaces.
  const trims: ChangeSpec[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    if (protectedLine.has(n)) continue
    const line = state.doc.line(n)
    const trimmed = line.text.replace(/[ \t]+$/, '')
    if (trimmed.length !== line.text.length) trims.push({ from: line.from + trimmed.length, to: line.to })
  }
  const trimmed = state.update({ changes: trims })

  // 2. Indentation, for every line that is not protected.
  const after = trimmed.state
  const ranges = []
  for (let n = 1; n <= after.doc.lines; n++) {
    if (protectedLine.has(n)) continue
    const line = after.doc.line(n)
    ranges.push(EditorSelection.range(line.from, line.from))
  }
  let indented: Transaction | null = null
  if (ranges.length > 0) {
    const selecting = after.update({ selection: EditorSelection.create(ranges) }).state
    indentSelection({ state: selecting, dispatch: tr => { indented = tr } })
  }

  const changes: ChangeSet = indented ? trimmed.changes.compose((indented as Transaction).changes) : trimmed.changes
  if (changes.empty) return false
  view.dispatch({ changes, selection: state.selection.map(changes), userEvent: 'format', scrollIntoView: true })
  return true
}

/** Line numbers whose leading or trailing whitespace is content (inside `<pre>` or `<textarea>`). */
function protectedLines(state: EditorState, text: string): Set<number> {
  const lines = new Set<number>()
  for (const m of text.matchAll(/<(pre|textarea)\b[\s\S]*?(?:<\/\1\s*>|$)/gi)) {
    const start = state.doc.lineAt(m.index).number
    const end = state.doc.lineAt(m.index + m[0].length).number
    for (let n = start + 1; n <= end; n++) lines.add(n)
  }
  return lines
}
