import { describe, expect, it } from 'vitest'
import { createDefaultLayout } from './default-interior'
import { LAYOUT_SCHEMA_VERSION, type HouseLayout } from './house-layout'
import { migrateLayout } from './layout-migrations'

const current = (houseId = 'house-a'): HouseLayout => createDefaultLayout(houseId)

/** A layout as an older build stored it, before the version field existed. */
function unversioned(houseId = 'house-a'): Record<string, unknown> {
  const { schemaVersion: _drop, ...rest } = current(houseId)
  return rest
}

describe('migrateLayout', () => {
  it('reads a current-version layout without migrating it', () => {
    const result = migrateLayout(current())
    expect(result.problems).toEqual([])
    expect(result.from).toBe(LAYOUT_SCHEMA_VERSION)
    expect(result.applied).toEqual([])
    expect(result.layout).toEqual(current())
  })

  it('upgrades a layout stored before layouts carried a version', () => {
    const result = migrateLayout(unversioned())
    expect(result.problems).toEqual([])
    expect(result.from).toBe(0)
    expect(result.applied).toEqual([0])
    expect(result.layout?.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('keeps every placement through the upgrade, nudges and attachments included', () => {
    const result = migrateLayout(unversioned())
    expect(result.layout?.items).toEqual(current().items)
    expect(result.layout?.items.find(i => i.id === 'lamp')?.at).toMatchObject({ kind: 'attached', to: 'nightstand' })
    expect(result.layout?.items.find(i => i.id === 'window-blue')?.at).toMatchObject({ kind: 'grid', nudge: { x: 12, y: 2 } })
  })

  it('runs each step in order, using the chain it is given', () => {
    const chain = {
      1: (layout: Record<string, unknown>) => ({ ...layout, schemaVersion: 2, houseId: `${String(layout.houseId)}-upgraded` }),
      2: (layout: Record<string, unknown>) => ({ ...layout, schemaVersion: 3 }),
    }
    const result = migrateLayout({ ...current('house-z') }, { target: 3, migrations: chain })
    expect(result.problems).toEqual([])
    expect(result.applied).toEqual([1, 2])
    expect(result.layout?.schemaVersion).toBe(3)
    expect(result.layout?.houseId).toBe('house-z-upgraded')
  })

  it('refuses a version it has no step for, and reports how far it got', () => {
    const result = migrateLayout(current(), {
      target: 3,
      migrations: { [LAYOUT_SCHEMA_VERSION]: layout => ({ ...layout, schemaVersion: 2 }) },
    })
    expect(result.layout).toBeUndefined()
    expect(result.applied).toEqual([LAYOUT_SCHEMA_VERSION])
    expect(result.problems.join(' ')).toMatch(/no migration from version 2/)
  })

  it('refuses a layout from a newer build instead of guessing', () => {
    const result = migrateLayout({ ...current(), schemaVersion: LAYOUT_SCHEMA_VERSION + 1 })
    expect(result.layout).toBeUndefined()
    expect(result.problems.join(' ')).toMatch(/newer than/)
  })

  it('refuses a schema version that is not a version', () => {
    for (const schemaVersion of ['1', 1.5, -1, Number.NaN]) {
      expect(migrateLayout({ ...current(), schemaVersion }).problems.join(' ')).toMatch(/not a version number/)
    }
  })

  it('refuses values that are not layouts at all', () => {
    for (const value of [undefined, null, 3, 'layout', [current()]]) {
      const result = migrateLayout(value)
      expect(result.layout).toBeUndefined()
      expect(result.problems.join(' ')).toMatch(/not a layout object/)
    }
  })

  it('refuses a layout whose items cannot be read', () => {
    const broken = {
      ...current(),
      items: [{ id: 'chest', type: 'chest' }],
    }
    const result = migrateLayout(broken)
    expect(result.layout).toBeUndefined()
    expect(result.problems.join(' ')).toMatch(/not readable/)
  })

  it('refuses a layout without a house or a template', () => {
    const { houseId: _house, ...noHouse } = current()
    const { templateId: _template, ...noTemplate } = current()
    expect(migrateLayout(noHouse).problems).not.toEqual([])
    expect(migrateLayout(noTemplate).problems).not.toEqual([])
  })
})
