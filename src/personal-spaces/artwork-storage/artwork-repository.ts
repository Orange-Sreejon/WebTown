import type { Artwork, ArtworkInput, ArtworkSummary } from './artwork'

/**
 * Where Sketchbook drawings are kept. Phase 3a: this browser's IndexedDB (or
 * memory when it is unusable). A shared backend in Phase 3b implements the same
 * interfaces. Readers are given to everyone; writers only to the owner.
 */
export interface ArtworkList {
  /** The house's drawings, newest first. */
  items: Artwork[]
  /** Records that could not be read, in words. They are left in storage. */
  skipped: string[]
}

export interface ArtworkReader {
  list(houseId: string): Promise<ArtworkList>
  /** One drawing of this house; null if there is none (or it belongs to another house). */
  get(houseId: string, id: string): Promise<Artwork | null>
}

export interface ArtworkWriter {
  /**
   * Stores a drawing: a new one when `input.id` is null, otherwise an update.
   * Throws `ValidationError` for bad data or when the house already has the most
   * drawings allowed, and `PermissionError` for an id that belongs to another house.
   */
  save(input: ArtworkInput): Promise<ArtworkSummary>
  /** Deletes one of this house's drawings. `PermissionError` for another house's. Unknown ids do nothing. */
  delete(houseId: string, id: string): Promise<void>
}

export interface ArtworkRepository extends ArtworkReader, ArtworkWriter {}

export interface ArtworkRepositoryOptions {
  now?: () => string
  /** Makes the id of a new drawing. Injected in tests. */
  newId?: () => string
}

export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
