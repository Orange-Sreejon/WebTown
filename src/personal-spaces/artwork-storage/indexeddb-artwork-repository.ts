import { PermissionError, PersonalSpacesError, StorageError, ValidationError } from '../errors'
import type { IdbDatabase } from '../storage/idb'
import { INDEX_ARTWORKS_BY_HOUSE, STORE_ARTWORKS } from '../storage/webtown-db'
import { recordProblem, summaryOf, toArtwork, validArtworkId, validHouseId, type Artwork, type ArtworkInput, type ArtworkRecord, type ArtworkSummary } from './artwork'
import { randomId, type ArtworkList, type ArtworkRepository, type ArtworkRepositoryOptions } from './artwork-repository'
import { planSave, readList } from './memory-artwork-repository'

const requireHouse = (houseId: string): void => {
  if (!validHouseId(houseId)) throw new ValidationError([{ path: 'houseId', message: 'That is not a valid house.' }])
}

/**
 * Sketchbook drawings in this browser's IndexedDB (store `artworks`, keyed by
 * `id`, index `byHouse`). Browser-local: other devices cannot see them.
 *
 * A save reads the stored record and the house's count and writes, all in one
 * transaction, so the house check and the limit cannot be raced.
 */
export class IndexedDbArtworkRepository implements ArtworkRepository {
  private readonly now: () => string
  private readonly newId: () => string

  constructor(private readonly db: IdbDatabase, options: ArtworkRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.newId = options.newId ?? randomId
  }

  async list(houseId: string): Promise<ArtworkList> {
    requireHouse(houseId)
    return readList(houseId, await this.db.getAllByIndex(STORE_ARTWORKS, INDEX_ARTWORKS_BY_HOUSE, houseId))
  }

  async get(houseId: string, id: string): Promise<Artwork | null> {
    requireHouse(houseId)
    if (!validArtworkId(id)) return null
    const raw = await this.db.get(STORE_ARTWORKS, id)
    return raw !== undefined && recordProblem(raw, houseId) === null ? toArtwork(raw as ArtworkRecord) : null
  }

  async save(input: ArtworkInput): Promise<ArtworkSummary> {
    const now = this.now()
    const record = await this.db.atomic<ArtworkRecord>([STORE_ARTWORKS], (tx, done, abort) => {
      const store = tx.objectStore(STORE_ARTWORKS)
      const fail = (error: unknown): void =>
        abort(error instanceof PersonalSpacesError ? error : new StorageError(undefined, error))
      const withExisting = (existing: unknown): void => {
        store.index(INDEX_ARTWORKS_BY_HOUSE).count(input?.houseId ?? '').onsuccess = (event): void => {
          let next: ArtworkRecord
          try {
            next = planSave(input, existing, (event.target as IDBRequest<number>).result, now, this.newId)
          } catch (error) {
            fail(error)
            return
          }
          store.put(next)
          done(next)
        }
      }
      if (input?.id && validArtworkId(input.id)) {
        store.get(input.id).onsuccess = (event): void => withExisting((event.target as IDBRequest).result)
      } else {
        withExisting(undefined)
      }
    })
    return summaryOf(toArtwork(record))
  }

  async delete(houseId: string, id: string): Promise<void> {
    requireHouse(houseId)
    if (!validArtworkId(id)) return
    await this.db.atomic<null>([STORE_ARTWORKS], (tx, done, abort) => {
      const store = tx.objectStore(STORE_ARTWORKS)
      store.get(id).onsuccess = (event): void => {
        const raw = (event.target as IDBRequest).result as { houseId?: unknown } | undefined
        if (raw === undefined) { done(null); return }
        if (raw?.houseId !== houseId) {
          abort(new PermissionError("This drawing belongs to a different house, so it can't be deleted here."))
          return
        }
        store.delete(id)
        done(null)
      }
    })
  }
}
