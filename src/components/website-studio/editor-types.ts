import type { Ref } from 'react'

/** The Studio's colour scheme. It changes WebTown's interface only, never the website being edited. */
export type StudioTheme = 'light' | 'dark'

/** What the Studio can ask of a code editor. */
export interface CodeEditorHandle {
  /** Replaces the selection (or inserts at the cursor) with `text`, and focuses the editor. */
  insert(text: string): void
  focus(): void
  /** Tidies the whole document: fixes indentation and trailing spaces. One undoable step. */
  format(): void
}

export interface CodeEditorProps {
  /** Which document this is, for example `page:index.html` or `css`. Each keeps its own undo history. */
  docKey: string
  value: string
  language: 'html' | 'css'
  onChange: (value: string) => void
  /** Accessible name. */
  label: string
  theme?: StudioTheme
  ref?: Ref<CodeEditorHandle>
}
