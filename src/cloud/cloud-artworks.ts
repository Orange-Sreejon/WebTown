import {
  ARTWORK_SCHEMA_VERSION,
  cleanArtworkTitle,
  recordProblem,
  requireValidInput,
  toArtwork,
  type Artwork,
  type ArtworkInput,
  type ArtworkRecord,
  type ArtworkSummary,
} from '../personal-spaces/artwork-storage/artwork'
import type { ArtworkList, ArtworkRepository } from '../personal-spaces/artwork-storage/artwork-repository'
import { PermissionError, ValidationError } from '../personal-spaces/errors'
import { isUuid, newUuid, toAppError, type CloudBackend } from './backend'
import { houseIdForSlot, type PlayerContext } from './player'

const BUCKET = 'artworks'
const CONFLICT = 'This drawing was changed or deleted somewhere else (another tab or device) since you opened it. Close the Sketchbook and open it again to see that version.'

interface StoredArtwork {
  id: string
  title: string
  width: number
  height: number
  transparent: boolean
  byteSize: number
  path: string
  revision: number
  createdAt: string
  updatedAt: string
}

/**
 * Sketchbook drawings in the player's account: details in the database, PNGs in Storage. A save uploads the new
 * image to a fresh path, then swaps it in with a database call that refuses a stale revision, then removes the
 * old image; a refused save never touches the stored drawing. Loaded images are checked like local ones.
 */
export class CloudArtworkRepository implements ArtworkRepository {
  /** The revision of each drawing as last read or written in this session. */
  private readonly revisions = new Map<string, number>()

  constructor(
    private readonly backend: CloudBackend,
    private readonly player: Pick<PlayerContext, 'houses' | 'world'>,
  ) {}

  async list(slot: string): Promise<ArtworkList> {
    const stored = await this.metadata(slot)
    const items: Artwork[] = []
    const skipped: string[] = []
    for (const s of stored) {
      const artwork = await this.read(slot, s)
      if (typeof artwork === 'string') skipped.push(artwork)
      else items.push(artwork)
    }
    return { items, skipped }
  }

  async get(slot: string, id: string): Promise<Artwork | null> {
    const s = (await this.metadata(slot)).find(m => m.id === id)
    if (!s) return null
    const artwork = await this.read(slot, s)
    return typeof artwork === 'string' ? null : artwork
  }

  async save(input: ArtworkInput, options: { importKey?: string } = {}): Promise<ArtworkSummary> {
    requireValidInput(input)
    const house = houseIdForSlot(this.player, input.houseId)
    if (!house) throw new PermissionError('This house is not in your world.')
    if (input.id !== null && !isUuid(input.id)) throw new ValidationError([{ path: 'id', message: 'That is not a valid drawing.' }])
    const path = `${this.player.world.id}/${house}/${newUuid()}.png`
    try {
      await this.backend.upload(BUCKET, path, input.png, 'image/png')
    } catch (error) {
      throw toAppError(error)
    }
    const base = input.id === null ? 0 : (this.revisions.get(input.id) ?? 0)
    let result: { id: string; revision: number; createdAt: string; updatedAt: string; oldPath: string | null; duplicate: boolean }
    try {
      result = await this.backend.rpc('save_artwork', {
        p_house: house,
        p_id: input.id,
        p_base_revision: base,
        p_title: cleanArtworkTitle(input.title),
        p_width: input.width,
        p_height: input.height,
        p_transparent: input.transparent,
        p_byte_size: input.png.byteLength,
        p_path: path,
        p_import_key: options.importKey ?? null,
      })
    } catch (error) {
      void this.removeQuietly([path])
      throw toAppError(error, CONFLICT)
    }
    if (result.duplicate) {
      void this.removeQuietly([path])
    } else {
      this.revisions.set(result.id, result.revision)
      if (result.oldPath) void this.removeQuietly([result.oldPath])
    }
    return {
      id: result.id,
      houseId: input.houseId,
      title: cleanArtworkTitle(input.title),
      width: input.width,
      height: input.height,
      transparent: input.transparent,
      byteSize: input.png.byteLength,
      createdAt: result.createdAt ?? '',
      updatedAt: result.updatedAt ?? '',
    }
  }

  async delete(slot: string, id: string): Promise<void> {
    const house = houseIdForSlot(this.player, slot)
    if (!house) throw new PermissionError('This house is not in your world.')
    if (!isUuid(id)) return
    let result: { removedPath: string | null }
    try {
      result = await this.backend.rpc('delete_artwork', { p_house: house, p_id: id })
    } catch (error) {
      throw toAppError(error)
    }
    this.revisions.delete(id)
    if (result.removedPath) void this.removeQuietly([result.removedPath])
  }

  private async metadata(slot: string): Promise<StoredArtwork[]> {
    const house = houseIdForSlot(this.player, slot)
    if (!house) return []
    try {
      const rows = await this.backend.rpc<StoredArtwork[]>('list_artworks', { p_house: house })
      return Array.isArray(rows) ? rows : []
    } catch (error) {
      throw toAppError(error)
    }
  }

  /** The drawing, or why it cannot be shown. */
  private async read(slot: string, s: StoredArtwork): Promise<Artwork | string> {
    let png: ArrayBuffer
    try {
      png = await this.backend.download(BUCKET, s.path)
    } catch (error) {
      console.warn(`[WebTown] Drawing ${s.title} could not be downloaded.`, error)
      return `${s.title} could not be downloaded.`
    }
    const record = {
      schemaVersion: ARTWORK_SCHEMA_VERSION, id: s.id, houseId: slot, title: s.title, width: s.width, height: s.height,
      transparent: s.transparent, png, byteSize: png.byteLength, createdAt: s.createdAt, updatedAt: s.updatedAt,
    }
    const problem = recordProblem(record, slot)
    if (problem) return problem
    this.revisions.set(s.id, s.revision)
    return toArtwork(record as ArtworkRecord)
  }

  private async removeQuietly(paths: string[]): Promise<void> {
    try {
      await this.backend.remove(BUCKET, paths)
    } catch (error) {
      console.warn('[WebTown] An old drawing image could not be removed.', error)
    }
  }
}
