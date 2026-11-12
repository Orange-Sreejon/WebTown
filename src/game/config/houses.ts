/**
 * Which buildings can be entered, and which interior each one opens onto.
 *
 * A house is data, not code: add a row here (and, for a new layout, an
 * `InteriorDefinition`) and it becomes enterable. The church and the bridge are
 * deliberately absent — the church stays an outdoor landmark.
 */

export interface HouseConfig {
  /** Stable id, also used in transition payloads. Matches the structure label. */
  id: string
  /** Label of the `StructurePlacement` this house is. */
  structureLabel: string
  /** Which `InteriorDefinition` the door leads to. */
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
