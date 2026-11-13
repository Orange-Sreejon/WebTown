/**
 * Which buildings can be entered, and which interior template each opens onto.
 *
 * A house is data, not code: add a row here and it becomes enterable. Every
 * house uses the same default template; what makes a house its own is its
 * furniture layout, which lives in the `HouseLayoutStore` (maps/house/) and
 * starts as an independent copy of the default. The church and the bridge are
 * deliberately absent — the church stays an outdoor landmark.
 */

export interface HouseConfig {
  /** Stable id, also used in transition payloads. Matches the structure label. */
  id: string
  /** Label of the `StructurePlacement` this house is. */
  structureLabel: string
  /** Which interior template the door leads to. Every house shares the default today. */
  interiorId: string
  /** Human-readable name, for future UI. */
  title: string
}

export const DEFAULT_INTERIOR_ID = 'cozy-room'

export const HOUSES: readonly HouseConfig[] = [
  { id: 'house-a', structureLabel: 'house-a', interiorId: DEFAULT_INTERIOR_ID, title: 'House A' },
  { id: 'house-b', structureLabel: 'house-b', interiorId: DEFAULT_INTERIOR_ID, title: 'House B' },
  { id: 'house-c', structureLabel: 'house-c', interiorId: DEFAULT_INTERIOR_ID, title: 'House C' },
  { id: 'house-d', structureLabel: 'house-d', interiorId: DEFAULT_INTERIOR_ID, title: 'House D' },
  { id: 'house-e', structureLabel: 'house-e', interiorId: DEFAULT_INTERIOR_ID, title: 'House E' },
  { id: 'house-f', structureLabel: 'house-f', interiorId: DEFAULT_INTERIOR_ID, title: 'House F' },
  { id: 'house-g', structureLabel: 'house-g', interiorId: DEFAULT_INTERIOR_ID, title: 'House G' },
]
