import { indentWithTab } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { EditorState, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { EditorView, basicSetup } from 'codemirror'
import { useEffect, useImperativeHandle, useRef } from 'react'
import type { CodeEditorProps } from './editor-types'

/**
 * The Studio's code editor: CodeMirror 6 with HTML or CSS highlighting, line
 * numbers, automatic indentation, bracket matching, search and undo. This is
 * the only file that imports CodeMirror, and it is only reached from the
 * owner's lazily loaded Studio, so visitors never download it.
 *
 * Tab indents. To move focus out with the keyboard, press Escape and then Tab
 * (CodeMirror's standard way out). Each document keeps its own undo history
 * while the Studio is open.
 */
export function CodeEditor({ docKey, value, language, onChange, label, ref }: CodeEditorProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const states = useRef(new Map<string, EditorState>())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const currentKey = useRef(docKey)

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
  }), [])

  const extensions = (lang: 'html' | 'css'): Extension[] => [
    basicSetup,
    keymap.of([indentWithTab]),
    lang === 'html' ? html() : css(),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // A change from outside (Start over, Reload): replace the text, as one undoable step.
  useEffect(() => {
    const view = viewRef.current
    if (!view || currentKey.current !== docKey) return
    const current = view.state.doc.toString()
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value, docKey])

  return (
    <div
      ref={hostRef}
      className="ws-code"
      onKeyDown={event => {
        // Escape belongs to the editor here (it is how you leave it with the keyboard), so it must not close the window.
        if (event.key === 'Escape') event.preventDefault()
      }}
    />
  )
}
