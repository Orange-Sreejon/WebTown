import { PermissionError, ValidationError } from '../errors'
import {
  ARTWORK_LIMITS,
  newestFirst,
  recordProblem,
  requireValidInput,
  summaryOf,
  toArtwork,
  toRecord,
  validArtworkId,
  validHouseId,
  type Artwork,
  type ArtworkInput,
  type ArtworkRecord,
  type ArtworkSummary,
} from './artwork'
import { randomId, type ArtworkList, type ArtworkRepository, type ArtworkRepositoryOptions } from './artwork-repository'

const requireHouse = (houseId: string): void => {
  if (!validHouseId(houseId)) throw new ValidationError([{ path: 'houseId', message: 'That is not a valid house.' }])
}

/** The rules every artwork repository applies on save, given what is stored now. */
export function planSave(input: ArtworkInput, existing: unknown, houseCount: number, now: string, newId: () => string): ArtworkRecord {
  requireValidInput(input)
  if (input.id !== null && existing !== undefined) {
    if ((existing as { houseId?: unknown } | null)?.houseId !== input.houseId) {
      throw new PermissionError("This drawing belongs to a different house, so it can't be saved here.")
    }
    const stored = recordProblem(existing, input.houseId) === null ? existing as ArtworkRecord : null
    return toRecord(input, input.id, stored, now)
  }
  if (houseCount >= ARTWORK_LIMITS.perHouse) {
    throw new ValidationError([{ path: 'house', message: `A Sketchbook can hold ${ARTWORK_LIMITS.perHouse} drawings. Delete one to start another.` }])
  }
  return toRecord(input, input.id ?? newId(), null, now)
}

/** Reads a house's records, skipping (and reporting) any that cannot be used. */
export function readList(houseId: string, raws: readonly unknown[]): ArtworkList {
  const items: Artwork[] = []
  const skipped: string[] = []
  for (const raw of raws) {
    const problem = recordProblem(raw, houseId)
    if (problem) skipped.push(problem)
    else items.push(toArtwork(raw as ArtworkRecord))
  }
  return { items: items.sort(newestFirst), skipped }
}

/**
 * Drawings in memory: gone on reload. Used when browser storage is unusable
 * (the Sketchbook then says "Not saved"), and by tests. Same rules as the
 * IndexedDB repository; the shared contract suite checks both.
 */
export class MemoryArtworkRepository implements ArtworkRepository {
  private readonly records = new Map<string, unknown>()
  private readonly now: () => string
  private readonly newId: () => string

  constructor(options: ArtworkRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.newId = options.newId ?? randomId
  }

  async list(houseId: string): Promise<ArtworkList> {
    requireHouse(houseId)
    return readList(houseId, [...this.records.values()].filter(r => (r as { houseId?: unknown } | null)?.houseId === houseId))
  }

  async get(houseId: string, id: string): Promise<Artwork | null> {
    requireHouse(houseId)
    if (!validArtworkId(id)) return null
    const raw = this.records.get(id)
    return raw !== undefined && recordProblem(raw, houseId) === null ? toArtwork(raw as ArtworkRecord) : null
  }

  async save(input: ArtworkInput): Promise<ArtworkSummary> {
    const existing = input?.id ? this.records.get(input.id) : undefined
    const count = [...this.records.values()].filter(r => (r as { houseId?: unknown } | null)?.houseId === input?.houseId).length
    const record = planSave(input, existing, count, this.now(), this.newId)
    this.records.set(record.id, record)
    return summaryOf(toArtwork(record))
  }

  async delete(houseId: string, id: string): Promise<void> {
    requireHouse(houseId)
    const raw = this.records.get(id)
    if (raw === undefined) return
    if ((raw as { houseId?: unknown } | null)?.houseId !== houseId) {
      throw new PermissionError("This drawing belongs to a different house, so it can't be deleted here.")
    }
    this.records.delete(id)
  }

  /** Puts a raw record in place, as if storage held it. For tests of damaged data. */
  seedRaw(record: { id: string } & Record<string, unknown>): void {
    this.records.set(record.id, record)
  }
}
