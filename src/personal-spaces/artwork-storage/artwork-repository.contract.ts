import { beforeEach, describe, expect, it } from 'vitest'
import { PermissionError, ValidationError } from '../errors'
import { ARTWORK_LIMITS, type ArtworkInput } from './artwork'
import type { ArtworkRepository } from './artwork-repository'

/**
 * The behaviour every `ArtworkRepository` must have, whatever it stores into.
 * Run against the memory and IndexedDB repositories.
 */

export interface ArtworkRepositoryUnderTest {
  repository: ArtworkRepository
  /** Stores a raw record with no checks, to stand in for damaged data. */
  seedUnchecked(record: { id: string } & Record<string, unknown>): Promise<void>
}

export interface ArtworkHarness {
  create(now: () => string, newId: () => string): Promise<ArtworkRepositoryUnderTest>
}

/** The first bytes of a PNG of the given size: enough for the signature and size check. */
export function fakePng(width: number, height: number, marker = 0): ArrayBuffer {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes[32] = marker
  return bytes.buffer
}

export const drawing = (houseId: string, change: Partial<ArtworkInput> = {}): ArtworkInput => ({
  id: null, houseId, title: 'Sunset', width: 640, height: 480, transparent: false, png: fakePng(640, 480), ...change,
})

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

export function describeArtworkRepositoryContract(name: string, harness: ArtworkHarness): void {
  describe(`${name}: the ArtworkRepository contract`, () => {
    let sut: ArtworkRepositoryUnderTest
    let repo: ArtworkRepository

    beforeEach(async () => {
      let t = 0
      let n = 0
      sut = await harness.create(() => new Date(Date.UTC(2026, 10, 20, 12, 0, t++)).toISOString(), () => `id-${++n}`)
      repo = sut.repository
    })

    it('has no drawings for a new house', async () => {
      expect(await repo.list('house-a')).toEqual({ items: [], skipped: [] })
      expect(await repo.get('house-a', 'id-1')).toBeNull()
    })

    it('creates a drawing and reads it back exactly', async () => {
      const saved = await repo.save(drawing('house-a', { png: fakePng(640, 480, 7), transparent: true }))
      expect(saved).toEqual({
        id: 'id-1', houseId: 'house-a', title: 'Sunset', width: 640, height: 480, transparent: true, byteSize: 33,
        createdAt: '2026-11-20T12:00:00.000Z', updatedAt: '2026-11-20T12:00:00.000Z',
      })
      const got = await repo.get('house-a', 'id-1')
      expect(new Uint8Array(got!.png)[32]).toBe(7)
      expect(got!.transparent).toBe(true)
    })

    it('updates a drawing in place, keeping its creation time', async () => {
      await repo.save(drawing('house-a'))
      const updated = await repo.save(drawing('house-a', { id: 'id-1', title: '  Night   sky ', width: 20, height: 10, png: fakePng(20, 10, 2) }))
      expect(updated.title).toBe('Night sky')
      expect(updated.createdAt).toBe('2026-11-20T12:00:00.000Z')
      expect(updated.updatedAt).toBe('2026-11-20T12:00:01.000Z')
      const { items } = await repo.list('house-a')
      expect(items).toHaveLength(1)
      expect([items[0]!.width, new Uint8Array(items[0]!.png)[32]]).toEqual([20, 2])
    })

    it('lists the newest first', async () => {
      await repo.save(drawing('house-a', { title: 'One' }))
      await repo.save(drawing('house-a', { title: 'Two' }))
      await repo.save(drawing('house-a', { id: 'id-1', title: 'One again' }))
      expect((await repo.list('house-a')).items.map(i => i.title)).toEqual(['One again', 'Two'])
    })

    it('refuses bad drawings and says why', async () => {
      for (const change of [
        { title: '   ' }, { title: 'x'.repeat(61) }, { width: 0, png: fakePng(0, 480) }, { width: 2000, png: fakePng(2000, 480) },
        { png: new TextEncoder().encode('<svg onload=alert(1)>').buffer as ArrayBuffer }, { png: fakePng(10, 10) },
        { png: new ArrayBuffer(ARTWORK_LIMITS.bytes + 1) }, { id: '../x' },
      ] as Partial<ArtworkInput>[]) {
        expect(await rejection(repo.save(drawing('house-a', change))), JSON.stringify(Object.keys(change))).toBeInstanceOf(ValidationError)
      }
      expect(await rejection(repo.save(drawing('../etc')))).toBeInstanceOf(ValidationError)
      expect((await repo.list('house-a')).items).toEqual([])
    })

    it('holds at most the limit of drawings per house', async () => {
      for (let i = 0; i < ARTWORK_LIMITS.perHouse; i++) await repo.save(drawing('house-a', { title: `D${i}` }))
      const error = await rejection(repo.save(drawing('house-a')))
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as Error).message).toContain('50')
      expect(await rejection(repo.save(drawing('house-a', { id: 'brand-new' })))).toBeInstanceOf(ValidationError)
      // Updates still work, and another house is not affected.
      await repo.save(drawing('house-a', { id: 'id-1', title: 'Still fine' }))
      await repo.save(drawing('house-b'))
    })

    it('deletes a drawing', async () => {
      await repo.save(drawing('house-a'))
      await repo.delete('house-a', 'id-1')
      expect(await repo.get('house-a', 'id-1')).toBeNull()
      await repo.delete('house-a', 'id-1') // again: nothing to do
    })

    describe('house isolation', () => {
      it("keeps each house's drawings to itself", async () => {
        await repo.save(drawing('house-a', { title: 'A' }))
        await repo.save(drawing('house-b', { title: 'B' }))
        expect((await repo.list('house-a')).items.map(i => i.title)).toEqual(['A'])
        expect((await repo.list('house-b')).items.map(i => i.title)).toEqual(['B'])
        expect(await repo.get('house-b', 'id-1')).toBeNull()
      })

      it("cannot overwrite another house's drawing by its id", async () => {
        await repo.save(drawing('house-a', { title: 'Mine' }))
        expect(await rejection(repo.save(drawing('house-b', { id: 'id-1', title: 'Stolen' })))).toBeInstanceOf(PermissionError)
        expect((await repo.get('house-a', 'id-1'))!.title).toBe('Mine')
      })

      it("cannot delete another house's drawing", async () => {
        await repo.save(drawing('house-a'))
        expect(await rejection(repo.delete('house-b', 'id-1'))).toBeInstanceOf(PermissionError)
        expect(await repo.get('house-a', 'id-1')).not.toBeNull()
      })
    })

    describe('damaged data', () => {
      it('skips a damaged record, says so, and leaves it in storage', async () => {
        await repo.save(drawing('house-a', { title: 'Good' }))
        await sut.seedUnchecked({ id: 'bad-1', houseId: 'house-a', schemaVersion: 1, title: 'Broken', png: 'nope' })
        const list = await repo.list('house-a')
        expect(list.items.map(i => i.title)).toEqual(['Good'])
        expect(list.skipped).toHaveLength(1)
        expect(list.skipped[0]).toContain('Broken')
        expect(await repo.get('house-a', 'bad-1')).toBeNull()
        expect((await repo.list('house-a')).skipped).toHaveLength(1)
      })

      it('can save a good drawing over a damaged one of the same house', async () => {
        await sut.seedUnchecked({ id: 'bad-1', houseId: 'house-a', schemaVersion: 1, title: 'Broken' })
        const saved = await repo.save(drawing('house-a', { id: 'bad-1' }))
        expect(saved.id).toBe('bad-1')
        expect((await repo.list('house-a')).skipped).toEqual([])
      })
    })

    it('hands out copies', async () => {
      const input = drawing('house-a', { png: fakePng(640, 480, 1) })
      await repo.save(input)
      new Uint8Array(input.png)[32] = 99
      const got = await repo.get('house-a', 'id-1')
      expect(new Uint8Array(got!.png)[32]).toBe(1)
      new Uint8Array(got!.png)[32] = 42
      expect(new Uint8Array((await repo.get('house-a', 'id-1'))!.png)[32]).toBe(1)
    })
  })
}
