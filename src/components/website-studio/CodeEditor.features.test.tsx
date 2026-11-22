import './codemirror-jsdom.test-support'
import { acceptCompletion, completionStatus, currentCompletions, startCompletion } from '@codemirror/autocomplete'
import { undo } from '@codemirror/commands'
import { diagnosticCount, forceLinting } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeEditor } from './CodeEditor'
import type { CodeEditorHandle, StudioTheme } from './editor-types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The editing features of the Studio's editor, driven through CodeMirror's own keyboard handling (key events
 * on the editable element) and commands, on the real editor. Typing-driven helpers (closing tags and brackets
 * as you type) need real input events and are covered in tests/e2e/code-editor.spec.mjs.
 */

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
const doc = (): string => view().state.doc.toString()

function mount(props: { value?: string; language?: 'html' | 'css'; theme?: StudioTheme; docKey?: string } = {}) {
  const ref = createRef<CodeEditorHandle>()
  const onChange = vi.fn()
  act(() =>
    root.render(
      <CodeEditor ref={ref} docKey={props.docKey ?? 'page:index.html'} value={props.value ?? ''} language={props.language ?? 'html'} theme={props.theme} label="code" onChange={onChange} />,
    ),
  )
  return { ref, onChange }
}

function key(name: string, mods: { shift?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, shiftKey: mods.shift ?? false, bubbles: true, cancelable: true })
  act(() => { view().contentDOM.dispatchEvent(event) })
  return event
}
const select = (anchor: number, head = anchor): void => act(() => view().dispatch({ selection: { anchor, head } }))

/** CodeMirror ignores an accept within its `interactionDelay` (75 ms) of the list opening, against stray keys. */
const waitInteraction = async (): Promise<void> => { await act(async () => { await new Promise(r => setTimeout(r, 100)) }) }

/** Asks for completions at the end of `text` and waits until CodeMirror has them. */
async function completionsAfter(text: string): Promise<string[]> {
  act(() => view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: text }, selection: { anchor: text.length } }))
  act(() => { startCompletion(view()) })
  for (let i = 0; i < 50 && completionStatus(view().state) !== 'active'; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  }
  return currentCompletions(view().state).map(c => c.label)
}

describe('Tab and Enter', () => {
  it('Tab indents the line and keeps the key from moving focus', () => {
    mount({ value: '<p>hi</p>' })
    select(0)
    const tab = key('Tab')
    expect(tab.defaultPrevented).toBe(true)
    expect(doc()).toBe('  <p>hi</p>')
  })

  it('Shift+Tab unindents', () => {
    mount({ value: '    <p>hi</p>' })
    select(6)
    key('Tab', { shift: true })
    expect(doc()).toBe('  <p>hi</p>')
  })

  it('indents and unindents every selected line', () => {
    mount({ value: '<ul>\n<li>a</li>\n<li>b</li>\n</ul>' })
    select(5, 24)
    key('Tab')
    expect(doc()).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
    key('Tab', { shift: true })
    expect(doc()).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>')
  })

  it('Enter keeps (and deepens) the indentation', () => {
    mount({ value: '<div>\n  <p>hi</p>\n</div>' })
    select(17) // after </p>
    key('Enter')
    expect(doc()).toBe('<div>\n  <p>hi</p>\n  \n</div>')
    mount({ value: 'body {\n  color: red;\n}', language: 'css', docKey: 'css' })
    select(20)
    key('Enter')
    expect(doc()).toBe('body {\n  color: red;\n  \n}')
  })
})

describe('autocomplete', () => {
  it('suggests HTML tags for what is typed', async () => {
    mount()
    const tags = await completionsAfter('<bl')
    expect(tags).toContain('blockquote')
    expect(tags.every(t => !t.startsWith('<'))).toBe(true)
  })

  it('suggests attributes of the element being written', async () => {
    mount()
    expect(await completionsAfter('<a hr')).toContain('href')
    expect(await completionsAfter('<img al')).toContain('alt')
  })

  it('offers the closing tag of the open element', async () => {
    mount()
    const labels = await completionsAfter('<section><p>hi</p></')
    expect(labels).toContain('section')
    // Accepting it writes the whole closing tag.
    await waitInteraction()
    act(() => { acceptCompletion(view()) })
    expect(doc()).toBe('<section><p>hi</p></section>')
  })

  it('suggests CSS properties, and values for the property', async () => {
    mount({ language: 'css', docKey: 'css' })
    expect(await completionsAfter('p { backg')).toContain('background-color')
    expect(await completionsAfter('p { display: fl')).toContain('flex')
    expect(await completionsAfter('p { display: fl')).not.toContain('color')
  })

  it('accepts a suggestion with the keyboard', async () => {
    mount()
    await completionsAfter('<blockq')
    await waitInteraction()
    act(() => { acceptCompletion(view()) })
    expect(doc()).toBe('<blockquote')
    await completionsAfter('<a hr')
    await waitInteraction()
    key('Enter')
    expect(doc()).toMatch(/^<a href/)
  })
})

describe('format', () => {
  it('fixes indentation and trailing spaces in one undoable step', () => {
    const messy = '<div>\n<ul>   \n<li>a</li>\n</ul>\n      </div>'
    const { ref } = mount({ value: messy })
    act(() => ref.current!.format())
    expect(doc()).toBe('<div>\n  <ul>\n    <li>a</li>\n  </ul>\n</div>')
    act(() => { undo(view()) })
    expect(doc()).toBe(messy)
  })

  it('formats CSS', () => {
    const { ref } = mount({ value: 'body {\ncolor: red;  \n    margin: 0;\n}', language: 'css', docKey: 'css' })
    act(() => ref.current!.format())
    expect(doc()).toBe('body {\n  color: red;\n  margin: 0;\n}')
  })

  it('never changes what is inside <pre> or <textarea>', () => {
    const text = '<div>\n<pre>\n   keep   \n  these\n</pre>\n<textarea>\n  as is  \n</textarea>\n</div>'
    const { ref } = mount({ value: text })
    act(() => ref.current!.format())
    expect(doc()).toContain('\n   keep   \n  these\n</pre>')
    expect(doc()).toContain('\n  as is  \n</textarea>')
    expect(doc()).toMatch(/^<div>\n  <pre>/)
  })

  it('also runs from Shift+Alt+F', () => {
    mount({ value: '<div>\n<p>x</p>\n</div>' })
    const event = new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', shiftKey: true, altKey: true, bubbles: true, cancelable: true })
    // Browsers set the legacy keyCode, which CodeMirror reads for Alt shortcuts; jsdom leaves it at 0.
    Object.defineProperty(event, 'keyCode', { value: 70 })
    act(() => { view().contentDOM.dispatchEvent(event) })
    expect(doc()).toBe('<div>\n  <p>x</p>\n</div>')
  })

  it('does nothing to a tidy document', () => {
    const { ref, onChange } = mount({ value: '<p>tidy</p>' })
    act(() => ref.current!.format())
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('warnings in the editor', () => {
  it("marks the markup check's findings on their lines", async () => {
    mount({ value: '<div>\n<p>ok</p>\n</span>' })
    act(() => { forceLinting(view()) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(diagnosticCount(view().state)).toBeGreaterThanOrEqual(2)
  })

  it('checks CSS braces', async () => {
    mount({ value: 'p { color: red;', language: 'css', docKey: 'css' })
    act(() => { forceLinting(view()) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(diagnosticCount(view().state)).toBe(1)
  })

  it('has nothing to say about good markup', async () => {
    mount({ value: '<p>fine</p>' })
    act(() => { forceLinting(view()) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(diagnosticCount(view().state)).toBe(0)
  })
})

describe('theme', () => {
  const isDark = (): boolean => view().state.facet(EditorView.darkTheme)

  it('is light by default and dark on request', () => {
    mount()
    expect(isDark()).toBe(false)
    act(() => root.render(<CodeEditor docKey="page:index.html" value="" language="html" theme="dark" label="code" onChange={vi.fn()} />))
    expect(isDark()).toBe(true)
  })

  it('switches without touching the text or the undo history', () => {
    mount({ value: '<p>a</p>' })
    act(() => view().dispatch({ changes: { from: 0, insert: 'x' } }))
    act(() => root.render(<CodeEditor docKey="page:index.html" value="x<p>a</p>" language="html" theme="dark" label="code" onChange={vi.fn()} />))
    expect(doc()).toBe('x<p>a</p>')
    act(() => { undo(view()) })
    expect(doc()).toBe('<p>a</p>')
  })

  it('applies to a document that was put away under the other theme', () => {
    mount({ docKey: 'page:a.html', value: 'A' })
    act(() => root.render(<CodeEditor docKey="page:b.html" value="B" language="html" theme="dark" label="b" onChange={vi.fn()} />))
    act(() => root.render(<CodeEditor docKey="page:a.html" value="A" language="html" theme="dark" label="a" onChange={vi.fn()} />))
    expect(doc()).toBe('A')
    expect(isDark()).toBe(true)
  })
})
