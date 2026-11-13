import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATE, createDefaultLayout } from './default-interior'
import { InMemoryHouseLayoutStore, houseLayouts } from './house-layout-store'
import { moveItem, removeItem, type EditResult } from './layout-edits'
import type { HouseLayout } from './house-layout'

const T = DEFAULT_TEMPLATE

function layoutOf(result: EditResult): HouseLayout {
  if (!result.ok) throw new Error(result.violations.map(x => x.message).join('; '))
  return result.layout
}

describe('InMemoryHouseLayoutStore', () => {
  it('gives an unedited house a copy of the default layout', async () => {
    const store = new InMemoryHouseLayoutStore()
    const layout = await store.load('house-a')
    expect(layout).toEqual(createDefaultLayout('house-a'))
    expect(layout.houseId).toBe('house-a')
  })

  it('keeps every house independent: saving one changes no other', async () => {
    const store = new InMemoryHouseLayoutStore()
    const a = await store.load('house-a')
    await store.save(layoutOf(moveItem(T, a, 'chest', { kind: 'grid', col: 5, row: 13 })))

    const b = layoutOf(removeItem(T, await store.load('house-b'), 'plant-red'))
    await store.save(b)

    const reloadedA = await store.load('house-a')
    const reloadedB = await store.load('house-b')
    const untouched = await store.load('house-c')

    expect(reloadedA.items.find(i => i.id === 'chest')!.at).toMatchObject({ col: 5, row: 13 })
    expect(reloadedA.items.some(i => i.id === 'plant-red')).toBe(true)
    expect(reloadedB.items.some(i => i.id === 'plant-red')).toBe(false)
    expect(reloadedB.items.find(i => i.id === 'chest')!.at).toEqual(
      createDefaultLayout('house-b').items.find(i => i.id === 'chest')!.at,
    )
    expect(untouched.items).toEqual(createDefaultLayout('house-c').items)
  })

  it('hands out copies: changing a loaded layout changes nothing until it is saved', async () => {
    const store = new InMemoryHouseLayoutStore()
    const loaded = await store.load('house-a')
    loaded.items.length = 0
    loaded.items.push({ id: 'junk', type: 'chest', rotation: 0, at: { kind: 'grid', col: 1, row: 1 } })

    expect(await store.load('house-a')).toEqual(createDefaultLayout('house-a'))
  })

  it('stores copies: changing a layout after saving it does not change the stored one', async () => {
    const store = new InMemoryHouseLayoutStore()
    const edited = layoutOf(moveItem(T, await store.load('house-a'), 'chest', {
      kind: 'grid', col: 5, row: 13,
    }))
    await store.save(edited)

    const chest = edited.items.find(i => i.id === 'chest')!
    if (chest.at.kind === 'grid') chest.at.col = 12
    edited.items.length = 0

    const stored = await store.load('house-a')
    expect(stored.items.find(i => i.id === 'chest')!.at).toMatchObject({ col: 5, row: 13 })
    expect(stored.items.length).toBeGreaterThan(0)
  })

  it('returns the same stored state on every load', async () => {
    const store = new InMemoryHouseLayoutStore()
    await store.save(layoutOf(moveItem(T, await store.load('house-a'), 'chest', {
      kind: 'grid', col: 5, row: 13,
    })))
    expect(await store.load('house-a')).toEqual(await store.load('house-a'))
  })

  it('refuses to save a layout that breaks a rule, and keeps what was stored', async () => {
    const store = new InMemoryHouseLayoutStore()
    const bad = await store.load('house-a')
    bad.items = bad.items.filter(i => i.id !== 'notebook')

    await expect(store.save(bad)).rejects.toThrow(/Layout rejected.*notebook/)
    expect(await store.load('house-a')).toEqual(createDefaultLayout('house-a'))
  })

  it('refuses a layout for an unknown template or without a house', async () => {
    const store = new InMemoryHouseLayoutStore()
    const layout = await store.load('house-a')
    await expect(store.save({ ...layout, templateId: 'mansion' })).rejects.toThrow(/Unknown interior template/)
    await expect(store.save({ ...layout, houseId: '' })).rejects.toThrow(/belong to a house/)
  })

  it('does not share state between store instances', async () => {
    const one = new InMemoryHouseLayoutStore()
    const two = new InMemoryHouseLayoutStore()
    await one.save(layoutOf(moveItem(T, await one.load('house-a'), 'chest', {
      kind: 'grid', col: 5, row: 13,
    })))
    expect(await two.load('house-a')).toEqual(createDefaultLayout('house-a'))
  })

  it('exposes one shared store for the game, starting from the default', async () => {
    expect(await houseLayouts.load('house-never-edited')).toEqual(
      createDefaultLayout('house-never-edited'),
    )
  })
})
