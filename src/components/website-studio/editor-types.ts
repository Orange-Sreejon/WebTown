import type { Ref } from 'react'

/** What the Studio can ask of a code editor. */
export interface CodeEditorHandle {
  /** Replaces the selection (or inserts at the cursor) with `text`, and focuses the editor. */
  insert(text: string): void
  focus(): void
}

export interface CodeEditorProps {
  /** Which document this is, for example `page:index.html` or `css`. Each keeps its own undo history. */
  docKey: string
  value: string
  language: 'html' | 'css'
  onChange: (value: string) => void
  /** Accessible name. */
  label: string
  ref?: Ref<CodeEditorHandle>
}
