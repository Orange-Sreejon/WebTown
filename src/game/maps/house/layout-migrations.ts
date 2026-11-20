import {
  LAYOUT_SCHEMA_VERSION,
  type HouseLayout,
  type PlacedItem,
  type Rotation,
} from './house-layout'

/**
 * Reading stored layouts that were written by an older (or newer) build.
 *
 * A layout carries the `schemaVersion` it was written at. Storage is not
 * versioned as a whole: each layout is upgraded on its own, one version at a
 * time, by the steps in `LAYOUT_MIGRATIONS`, and only the CURRENT shape ever
 * reaches the game. A step is a small, pure function from the version-n shape
 * to the version-(n + 1) shape, so a bump is one entry plus one test.
 *
 * Version 0 is "stored before layouts carried a version at all": the shape was
 * the same, only the field was missing.
 */

/** Turns a layout stored at `from` into the shape of `from + 1`. */
export type LayoutMigration = (layout: Record<string, unknown>) => Record<string, unknown>

/** Keyed by the version it upgrades FROM. Add `1: ...` when the schema reaches 2. */
export const LAYOUT_MIGRATIONS: Readonly<Record<number, LayoutMigration>> = {
  0: layout => ({ ...layout, schemaVersion: 1 }),
}

export interface MigrationResult {
  /** The layout at the current version; absent when it could not be read at all. */
  layout?: HouseLayout
  /** The version it was stored at. 0 means it predates versioning. */
  from: number
  /** The steps that were applied, in order. Empty for a current-version layout. */
  applied: number[]
  /** Why it could not be read (or upgraded). Empty when it could. */
  problems: string[]
}

export interface MigrationOptions {
  /** The version this build understands. */
  target?: number
  /** The chain to use; injectable so a future bump can be tested before it ships. */
  migrations?: Readonly<Record<number, LayoutMigration>>
}

/** Reads `raw` as a layout of the current version, or says why it cannot. */
export function migrateLayout(raw: unknown, options: MigrationOptions = {}): MigrationResult {
  const target = options.target ?? LAYOUT_SCHEMA_VERSION
  const migrations = options.migrations ?? LAYOUT_MIGRATIONS

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { from: 0, applied: [], problems: ['it is not a layout object'] }
  }

  let working = { ...(raw as Record<string, unknown>) }
  const declared = working.schemaVersion
  const from = declared === undefined || declared === null ? 0 : declared
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) {
    return { from: 0, applied: [], problems: [`its schema version "${String(declared)}" is not a version number`] }
  }

  if (from > target) {
    return {
      from,
      applied: [],
      problems: [`it was written at version ${from}, newer than the ${target} this build reads`],
    }
  }

  const applied: number[] = []
  for (let version = from; version < target; version++) {
    const step = migrations[version]
    if (!step) return { from, applied, problems: [`there is no migration from version ${version}`] }
    working = step(working)
    applied.push(version)
  }

  const layout = readLayout(working, target)
  if (!layout) return { from, applied, problems: ['its house, template or items are not readable'] }
  return { layout, from, applied, problems: [] }
}

/**
 * Coerces the (migrated) object into a layout. Deliberately shallow: it only
 * guarantees the shape `validateLayout` can safely inspect. Whether the
 * furniture is legal is the rules' job, not this one's.
 */
function readLayout(value: Record<string, unknown>, version: number): HouseLayout | undefined {
  const { houseId, templateId, items } = value
  if (typeof houseId !== 'string' || houseId.length === 0) return undefined
  if (typeof templateId !== 'string' || templateId.length === 0) return undefined
  if (!Array.isArray(items)) return undefined

  const readItems: PlacedItem[] = []
  for (const item of items) {
    const read = readItem(item)
    if (!read) return undefined
    readItems.push(read)
  }

  return { houseId, templateId, schemaVersion: version, items: readItems }
}

function readItem(value: unknown): PlacedItem | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0) return undefined
  if (typeof raw.type !== 'string' || raw.type.length === 0) return undefined
  if (typeof raw.rotation !== 'number') return undefined
  const at = readPlacement(raw.at)
  if (!at) return undefined
  return { id: raw.id, type: raw.type, rotation: raw.rotation as Rotation, at }
}

function readPlacement(value: unknown): PlacedItem['at'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>

  if (raw.kind === 'grid') {
    if (!Number.isInteger(raw.col) || !Number.isInteger(raw.row)) return undefined
    const nudge = raw.nudge
    if (nudge === undefined) return { kind: 'grid', col: raw.col as number, row: raw.row as number }
    if (typeof nudge !== 'object' || nudge === null) return undefined
    const { x, y } = nudge as Record<string, unknown>
    if (typeof x !== 'number' || typeof y !== 'number') return undefined
    return { kind: 'grid', col: raw.col as number, row: raw.row as number, nudge: { x, y } }
  }

  if (raw.kind === 'attached') {
    if (typeof raw.to !== 'string' || raw.to.length === 0) return undefined
    if (typeof raw.dx !== 'number' || typeof raw.dy !== 'number') return undefined
    return { kind: 'attached', to: raw.to, dx: raw.dx, dy: raw.dy }
  }

  return undefined
}
