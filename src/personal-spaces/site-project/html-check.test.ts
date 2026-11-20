import { describe, expect, it } from 'vitest'
import { checkCss, checkHtml } from './html-check'
import { BLANK_INDEX, classicProject } from './templates'
import { HISTORY_LIMIT, canGoBack, canGoForward, currentPage, historyReducer, startHistory } from './page-history'

describe('checkHtml', () => {
  it('finds nothing wrong with the templates', () => {
    expect(checkHtml(BLANK_INDEX)).toEqual([])
    for (const page of classicProject('house-a', '2026-11-17T00:00:00.000Z').pages) {
      expect(checkHtml(page.html), page.name).toEqual([])
    }
  })

  it('is happy with void elements, self-closing tags, optional end tags and comments', () => {
    const html = '<!DOCTYPE html>\n<img src="a.png"><br><br/><hr>\n<ul><li>one<li>two</ul>\n<p>a<p>b\n<table><tr><td>1<td>2</table>\n<!-- a <div> in a comment -->\n<svg><circle r="2"/></svg>'
    expect(checkHtml(html)).toEqual([])
  })

  it('ignores markup inside style, script, textarea and title', () => {
    expect(checkHtml('<style>div > p { content: "</div>" }</style><title><b></title><textarea><div></textarea>')).toEqual([])
  })

  it('reports a tag never closed, with its line', () => {
    expect(checkHtml('<div>\n  <section>\n</div>')).toEqual([{ line: 2, message: '<section> (line 2) is not closed before </div> on line 3.' }])
    expect(checkHtml('<main>\n<div>')).toEqual([
      { line: 1, message: '<main> is never closed.' },
      { line: 2, message: '<div> is never closed.' },
    ])
  })

  it('reports a closing tag with nothing to close', () => {
    expect(checkHtml('<p>hi</p>\n</div>')).toEqual([{ line: 2, message: '</div> closes a tag that is not open.' }])
    expect(checkHtml('<img src=x></img>')).toEqual([{ line: 1, message: '</img> is not needed: <img> has no closing tag.' }])
  })

  it('reports an unclosed comment and an unclosed style', () => {
    expect(checkHtml('<p>x</p>\n<!-- forgot')).toEqual([{ line: 2, message: 'This comment is never closed with -->.' }])
    expect(checkHtml('<style>\nbody{}')).toEqual([{ line: 1, message: '<style> is never closed.' }])
  })

  it('handles attributes with > and quotes inside them', () => {
    expect(checkHtml('<div title="a > b" data-x=\'</div>\'>ok</div>')).toEqual([])
  })

  it('never throws and stays quick on hostile input', () => {
    const big = '<div>'.repeat(20000)
    const start = Date.now()
    const notes = checkHtml(big)
    expect(notes.length).toBeLessThanOrEqual(50)
    expect(Date.now() - start).toBeLessThan(2000)
    expect(() => checkHtml('<<<>>></ /><a <b')).not.toThrow()
  })

  it('stays linear on unfinished tags, quotes and comments', () => {
    const hostile = ['<a '.repeat(30000), '<a' + ' x='.repeat(20000), '<!--'.repeat(30000), '</a'.repeat(30000),
      '<p title="' + 'x'.repeat(100000)]
    const start = Date.now()
    for (const input of hostile) checkHtml(input)
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('reports a tag that is never finished', () => {
    expect(checkHtml('<p>ok</p>\n<img src="a.png"')).toEqual([{ line: 2, message: '<img is never finished with >.' }])
  })
})

describe('checkCss', () => {
  it('accepts balanced CSS with nested at-rules', () => {
    expect(checkCss('@media (max-width: 600px) { .a { color: red } }\n@keyframes x { from { opacity: 0 } to { opacity: 1 } }')).toEqual([])
  })

  it('ignores braces in comments and strings', () => {
    expect(checkCss('/* { */ .a::before { content: "}" } .b { content: \'{\' }')).toEqual([])
  })

  it('reports unbalanced braces and unclosed comments, with lines', () => {
    expect(checkCss('.a {\n color: red;\n')).toEqual([{ line: 1, message: 'This { is never closed with }.' }])
    expect(checkCss('.a { }\n}')).toEqual([{ line: 2, message: 'This } has no matching {.' }])
    expect(checkCss('.a {}\n/* oops')).toEqual([{ line: 2, message: 'This comment is never closed with */.' }])
  })
})

describe('page history', () => {
  it('goes back and forward through visited pages', () => {
    let h = startHistory('index.html')
    h = historyReducer(h, { type: 'go', page: 'about.html' })
    h = historyReducer(h, { type: 'go', page: 'blog.html' })
    expect(currentPage(h)).toBe('blog.html')
    h = historyReducer(h, { type: 'back' })
    expect(currentPage(h)).toBe('about.html')
    expect(canGoForward(h)).toBe(true)
    h = historyReducer(h, { type: 'go', page: 'links.html' })
    expect(canGoForward(h)).toBe(false)
    expect(h.entries).toEqual(['index.html', 'about.html', 'links.html'])
  })

  it('does not record the page already shown, and stops at the ends', () => {
    const h = startHistory('index.html')
    expect(historyReducer(h, { type: 'go', page: 'index.html' })).toBe(h)
    expect(historyReducer(h, { type: 'back' })).toBe(h)
    expect(historyReducer(h, { type: 'forward' })).toBe(h)
    expect(canGoBack(h)).toBe(false)
  })

  it('remembers a limited number of pages', () => {
    let h = startHistory('p0.html')
    for (let i = 1; i < HISTORY_LIMIT * 2; i++) h = historyReducer(h, { type: 'go', page: `p${i}.html` })
    expect(h.entries.length).toBe(HISTORY_LIMIT)
  })

  it('resets to a page', () => {
    expect(historyReducer(historyReducer(startHistory('a.html'), { type: 'go', page: 'b.html' }), { type: 'reset', page: 'c.html' }).entries).toEqual(['c.html'])
  })
})
