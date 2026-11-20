import './codemirror-jsdom.test-support'
import { EditorView } from '@codemirror/view'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeEditor } from './CodeEditor'
import type { CodeEditorHandle } from './editor-types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const view = (): EditorView => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!

function mount(props: { docKey?: string; value?: string; language?: 'html' | 'css'; onChange?: (v: string) => void } = {}) {
  const ref = createRef<CodeEditorHandle>()
  const onChange = props.onChange ?? vi.fn()
  act(() =>
    root.render(
      <CodeEditor ref={ref} docKey={props.docKey ?? 'page:index.html'} value={props.value ?? '<p>hi</p>'} language={props.language ?? 'html'} label="index.html HTML code" onChange={onChange} />,
    ),
  )
  return { ref, onChange }
}

describe('CodeEditor (CodeMirror)', () => {
  it('shows the code with line numbers and an accessible name', () => {
    mount({ value: '<div>\n  <p>hi</p>\n</div>' })
    expect(view().state.doc.toString()).toBe('<div>\n  <p>hi</p>\n</div>')
    expect(container.querySelector('.cm-lineNumbers')).not.toBeNull()
    expect(container.querySelector('.cm-content')!.getAttribute('aria-label')).toBe('index.html HTML code')
  })

  it('highlights HTML and CSS', () => {
    mount({ value: '<p class="x">hi</p>' })
    expect(container.querySelectorAll('.cm-content span').length).toBeGreaterThan(0)
    act(() => root.render(<CodeEditor docKey="css" value="body { color: red }" language="css" label="css" onChange={vi.fn()} />))
    expect(view().state.doc.toString()).toBe('body { color: red }')
    expect(container.querySelectorAll('.cm-content span').length).toBeGreaterThan(0)
  })

  it('reports typing', () => {
    const { onChange } = mount({ value: '' })
    act(() => view().dispatch({ changes: { from: 0, insert: '<h1>Zine</h1>' } }))
    expect(onChange).toHaveBeenCalledWith('<h1>Zine</h1>')
  })

  it('indents a new line inside an element', () => {
    mount({ value: '<div></div>' })
    const v = view()
    act(() => v.dispatch({ selection: { anchor: 5 } }))
    // Enter, as the keymap runs it.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    act(() => { v.contentDOM.dispatchEvent(enter) })
    expect(v.state.doc.toString()).toMatch(/^<div>\n\s+\n<\/div>$/)
  })

  it('takes changes from outside without losing the document', () => {
    mount({ value: 'a' })
    act(() => root.render(<CodeEditor docKey="page:index.html" value="b" language="html" label="x" onChange={vi.fn()} />))
    expect(view().state.doc.toString()).toBe('b')
  })

  it('inserts at the cursor', () => {
    const { ref } = mount({ value: '<body></body>' })
    act(() => view().dispatch({ selection: { anchor: 6 } }))
    act(() => ref.current!.insert('<img src="assets/cat.png" alt="cat">'))
    expect(view().state.doc.toString()).toBe('<body><img src="assets/cat.png" alt="cat"></body>')
  })

  it('keeps each document separately when switching', () => {
    const { onChange } = mount({ docKey: 'page:a.html', value: 'A' })
    act(() => view().dispatch({ changes: { from: 1, insert: '!' } }))
    expect(onChange).toHaveBeenLastCalledWith('A!')
    act(() => root.render(<CodeEditor docKey="page:b.html" value="B" language="html" label="b" onChange={onChange} />))
    expect(view().state.doc.toString()).toBe('B')
    act(() => root.render(<CodeEditor docKey="page:a.html" value="A!" language="html" label="a" onChange={onChange} />))
    expect(view().state.doc.toString()).toBe('A!')
  })

  it('keeps Escape for the editor instead of closing the window', () => {
    mount()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { view().contentDOM.dispatchEvent(escape) })
    expect(escape.defaultPrevented).toBe(true)
  })
})
