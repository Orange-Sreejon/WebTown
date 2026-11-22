import { useImperativeHandle, useRef } from 'react'
import type { CodeEditorProps } from './editor-types'

/** Test support: a textarea standing in for CodeMirror, with the same props and handle. */
export function PlainEditor({ value, onChange, label, language, docKey, theme = 'light', ref }: CodeEditorProps): React.ReactElement {
  const area = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const el = area.current!
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      onChange(el.value.slice(0, start) + text + el.value.slice(end))
    },
    focus() {
      area.current?.focus()
    },
    format() {
      // Stand-in for CodeMirror's re-indent: trailing spaces only. The real Format is tested on CodeEditor.
      onChange(area.current!.value.replace(/[ \t]+$/gm, ''))
    },
  }), [onChange])
  return (
    <textarea
      ref={area}
      className="ws-plain-editor"
      aria-label={label}
      data-language={language}
      data-doc={docKey}
      data-theme={theme}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  )
}
