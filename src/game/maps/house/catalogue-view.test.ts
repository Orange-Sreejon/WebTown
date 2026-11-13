import { describe, expect, it } from 'vitest'
import { catalogueEntries, isAddable, thumbnailFor } from './catalogue-view'

describe('editor catalogue', () => {
  const entries = catalogueEntries()
  const types = entries.map(e => e.type)

  it('never offers the computer or the notebook', () => {
    expect(types).not.toContain('computer-desk')
    expect(types).not.toContain('notebook')
    expect(isAddable('computer-desk')).toBe(false)
    expect(isAddable('notebook')).toBe(false)
    expect(isAddable('nope')).toBe(false)
  })

  it('offers ordinary furniture with labels', () => {
    expect(types).toEqual(expect.arrayContaining(['chair', 'stool', 'table', 'bed-blue', 'rug-blue']))
    for (const entry of entries) expect(entry.label.length).toBeGreaterThan(0)
    expect(isAddable('chair')).toBe(true)
  })

  it('gives sheet thumbnails as same-origin rectangles, and none for prepared sprites', () => {
    const chair = entries.find(e => e.type === 'chair')!
    expect(chair.thumbnail).toMatchObject({ url: '/assets/interior/work4.png', w: 15, h: 26 })
    expect(chair.thumbnail!.url.startsWith('/')).toBe(true)
    expect(thumbnailFor({ sheet: 'prepared', name: 'bookStack' })).toBeNull()
    expect(entries.find(e => e.type === 'book-stack')!.thumbnail).toBeNull()
  })
})
