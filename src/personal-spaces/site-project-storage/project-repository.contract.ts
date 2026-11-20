import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, PermissionError, ValidationError } from '../errors'
import { blankProject } from '../site-project/templates'
import { GIF_ANIMATED, PNG_1PX } from '../site-project/test-images.test-support'
import type { SiteAsset, SiteProject, SiteSave } from '../site-project/types'
import type { ProjectLoad } from './project-record'
import type { SiteProjectRepository } from './project-repository'

/**
 * The behaviour every `SiteProjectRepository` must have, whatever it stores
 * into. Run against the memory and IndexedDB repositories.
 */

export interface ProjectRepositoryUnderTest {
  repository: SiteProjectRepository
  /** Stores raw records with no checks, to stand in for damaged data. */
  seedUnchecked(houseId: string, project: unknown, assets?: readonly unknown[]): Promise<void>
}

export interface ProjectHarness {
  create(now: () => string): Promise<ProjectRepositoryUnderTest>
}

export function steppingClock(): () => string {
  let n = 0
  return () => new Date(Date.UTC(2026, 10, 16, 12, 0, n++)).toISOString()
}

const BASE = '2026-11-16T00:00:00.000Z'

export function asset(houseId: string, id: string, name: string, bytes: ArrayBuffer = PNG_1PX()): SiteAsset {
  const mimeType = name.endsWith('.gif') ? 'image/gif' : 'image/png'
  return { id, name, mimeType, size: bytes.byteLength, houseId, bytes }
}

const meta = (a: SiteAsset) => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size })

export function projectWith(houseId: string, assets: readonly SiteAsset[] = [], change: Partial<SiteProject> = {}): SiteProject {
  return { ...blankProject(houseId, BASE), assets: assets.map(meta), ...change }
}

export const saveOf = (project: SiteProject, baseRevision: number, putAssets: SiteAsset[] = [], deleteAssetIds: string[] = []): SiteSave =>
  ({ project, baseRevision, putAssets, deleteAssetIds })

const bytesOf = (buffer: ArrayBuffer): number[] => Array.from(new Uint8Array(buffer))

function saved(load: ProjectLoad): Extract<ProjectLoad, { kind: 'saved' }> {
  if (load.kind !== 'saved') throw new Error(`expected a saved website, got ${load.kind}`)
  return load
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

export function describeProjectRepositoryContract(name: string, harness: ProjectHarness): void {
  describe(`${name}: the SiteProjectRepository contract`, () => {
    let sut: ProjectRepositoryUnderTest
    let repo: SiteProjectRepository

    beforeEach(async () => {
      sut = await harness.create(steppingClock())
      repo = sut.repository
    })

    it('has nothing for a house that never saved', async () => {
      expect(await repo.load('house-a')).toEqual({ kind: 'none' })
    })

    it('refuses a house id that is not valid', async () => {
      expect(await rejection(repo.load('../etc'))).toBeInstanceOf(ValidationError)
    })

    it('saves pages, stylesheet and images together, and loads them back exactly', async () => {
      const banner = asset('house-a', 'id-1', 'my-banner.gif', GIF_ANIMATED())
      const project = projectWith('house-a', [banner], {
        pages: [{ name: 'index.html', html: '<h1>Zine</h1><img src="assets/my-banner.gif">' }, { name: 'b.html', html: 'b' }],
        css: 'body { display: grid }',
      })
      const result = await repo.save(saveOf(project, 0, [banner]))
      expect(result.revision).toBe(1)
      expect(result.updatedAt).toBe('2026-11-16T12:00:00.000Z')
      expect(result.createdAt).toBe(BASE)

      const load = saved(await repo.load('house-a'))
      expect(load.skipped).toEqual([])
      expect(load.snapshot.project).toEqual(result)
      expect(load.snapshot.assets).toHaveLength(1)
      expect(bytesOf(load.snapshot.assets[0]!.bytes)).toEqual(bytesOf(GIF_ANIMATED()))
      expect(load.snapshot.assets[0]!.name).toBe('my-banner.gif')
    })

    it('counts revisions up on every save', async () => {
      const first = await repo.save(saveOf(projectWith('house-a'), 0))
      const second = await repo.save(saveOf({ ...first, css: 'p{}' }, first.revision))
      expect(second.revision).toBe(2)
      expect(saved(await repo.load('house-a')).snapshot.project.css).toBe('p{}')
    })

    it('refuses a save that started from an older version, and keeps the newer one', async () => {
      const first = await repo.save(saveOf(projectWith('house-a'), 0))
      await repo.save(saveOf({ ...first, css: 'from tab one' }, 1))
      const error = await rejection(repo.save(saveOf({ ...first, css: 'from tab two' }, 1)))
      expect(error).toBeInstanceOf(ConflictError)
      expect(saved(await repo.load('house-a')).snapshot.project.css).toBe('from tab one')
    })

    it('refuses a first save when another tab saved first', async () => {
      await repo.save(saveOf(projectWith('house-a'), 0))
      expect(await rejection(repo.save(saveOf(projectWith('house-a'), 0)))).toBeInstanceOf(ConflictError)
    })

    it('writes nothing at all when a save is refused', async () => {
      const first = await repo.save(saveOf(projectWith('house-a'), 0))
      const pic = asset('house-a', 'id-2', 'pic.png')
      await rejection(repo.save(saveOf(projectWith('house-a', [pic]), 0, [pic])))
      const load = saved(await repo.load('house-a'))
      expect(load.snapshot.project).toEqual(first)
      expect(load.snapshot.assets).toEqual([])
    })

    it('removes deleted images', async () => {
      const pic = asset('house-a', 'id-1', 'pic.png')
      const first = await repo.save(saveOf(projectWith('house-a', [pic]), 0, [pic]))
      await repo.save(saveOf({ ...first, assets: [] }, 1, [], ['id-1']))
      const load = saved(await repo.load('house-a'))
      expect(load.snapshot.assets).toEqual([])
      expect(load.snapshot.project.assets).toEqual([])
    })

    it('keeps images that are not changed in later saves', async () => {
      const pic = asset('house-a', 'id-1', 'pic.png')
      const first = await repo.save(saveOf(projectWith('house-a', [pic]), 0, [pic]))
      await repo.save(saveOf({ ...first, css: 'x{}' }, 1))
      expect(saved(await repo.load('house-a')).snapshot.assets.map(a => a.id)).toEqual(['id-1'])
    })

    it('refuses an image that is not listed in the website', async () => {
      const pic = asset('house-a', 'id-1', 'pic.png')
      expect(await rejection(repo.save(saveOf(projectWith('house-a'), 0, [pic])))).toBeInstanceOf(ValidationError)
      expect(await repo.load('house-a')).toEqual({ kind: 'none' })
    })

    it('refuses a listed image with no data', async () => {
      const pic = asset('house-a', 'id-1', 'pic.png')
      expect(await rejection(repo.save(saveOf(projectWith('house-a', [pic]), 0)))).toBeInstanceOf(ValidationError)
    })

    it('refuses an image whose bytes are not what its name says', async () => {
      const fake = asset('house-a', 'id-1', 'pic.png', new TextEncoder().encode('<script>').buffer as ArrayBuffer)
      expect(await rejection(repo.save(saveOf(projectWith('house-a', [fake]), 0, [fake])))).toBeInstanceOf(ValidationError)
    })

    it('refuses a website that breaks the rules', async () => {
      const error = await rejection(repo.save(saveOf(projectWith('house-a', [], { pages: [] }), 0)))
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).issues.length).toBeGreaterThan(0)
    })

    it('cleans the website name', async () => {
      const result = await repo.save(saveOf(projectWith('house-a', [], { title: '  My\u0000 site  ' }), 0))
      expect(result.title).toBe('My site')
    })

    it('hands out copies, never its own objects', async () => {
      const project = projectWith('house-a')
      const result = await repo.save(saveOf(project, 0))
      result.pages[0]!.html = 'changed'
      project.pages[0]!.html = 'changed too'
      const load = saved(await repo.load('house-a'))
      expect(load.snapshot.project.pages[0]!.html).not.toMatch(/changed/)
      load.snapshot.project.css = 'mutated'
      expect(saved(await repo.load('house-a')).snapshot.project.css).toBe('')
    })

    describe('house isolation', () => {
      it('keeps each house to its own website and images', async () => {
        const a = asset('house-a', 'id-a', 'a.png')
        await repo.save(saveOf(projectWith('house-a', [a], { css: 'a' }), 0, [a]))
        await repo.save(saveOf(projectWith('house-b', [], { css: 'b' }), 0))
        const b = saved(await repo.load('house-b'))
        expect(b.snapshot.project.css).toBe('b')
        expect(b.snapshot.assets).toEqual([])
      })

      it("cannot remove another house's image", async () => {
        const a = asset('house-a', 'id-a', 'a.png')
        await repo.save(saveOf(projectWith('house-a', [a]), 0, [a]))
        const error = await rejection(repo.save(saveOf(projectWith('house-b'), 0, [], ['id-a'])))
        expect(error).toBeInstanceOf(PermissionError)
        expect(saved(await repo.load('house-a')).snapshot.assets.map(x => x.id)).toEqual(['id-a'])
      })

      it("cannot overwrite another house's image by reusing its id", async () => {
        const a = asset('house-a', 'id-a', 'a.png')
        await repo.save(saveOf(projectWith('house-a', [a]), 0, [a]))
        const renamed = asset('house-b', 'id-a', 'a.gif', GIF_ANIMATED())
        const error = await rejection(repo.save(saveOf(projectWith('house-b', [renamed]), 0, [renamed])))
        expect(error).toBeInstanceOf(PermissionError)
        expect(bytesOf(saved(await repo.load('house-a')).snapshot.assets[0]!.bytes)).toEqual(bytesOf(PNG_1PX()))
      })

      it("cannot list another house's image without uploading it", async () => {
        const a = asset('house-a', 'id-a', 'a.png')
        await repo.save(saveOf(projectWith('house-a', [a]), 0, [a]))
        const error = await rejection(repo.save(saveOf(projectWith('house-b', [a]), 0)))
        expect(error).toBeInstanceOf(ValidationError)
      })

      it('refuses an image record marked for a different house', async () => {
        const wrong = asset('house-b', 'id-1', 'pic.png')
        expect(await rejection(repo.save(saveOf(projectWith('house-a', [wrong]), 0, [wrong])))).toBeInstanceOf(ValidationError)
      })
    })

    describe('damaged data', () => {
      it('reports a damaged website without deleting it, and can save over it', async () => {
        await sut.seedUnchecked('house-a', { houseId: 'house-a', revision: 4, pages: 'nope' })
        const load = await repo.load('house-a')
        expect(load.kind).toBe('damaged')
        if (load.kind !== 'damaged') return
        expect(load.revision).toBe(4)
        expect(load.problems.length).toBeGreaterThan(0)
        expect((await repo.load('house-a')).kind).toBe('damaged')

        const result = await repo.save(saveOf(projectWith('house-a'), load.revision))
        expect(result.revision).toBe(5)
      })

      it('leaves out damaged or missing images, says which, and loads the rest', async () => {
        const good = asset('house-a', 'id-1', 'good.png')
        const broken = { ...asset('house-a', 'id-2', 'broken.png'), bytes: new TextEncoder().encode('nope!').buffer }
        const missing = asset('house-a', 'id-3', 'missing.png')
        const project = { ...projectWith('house-a', [good, missing]), assets: [meta(good), { ...meta(broken), size: 5 }, meta(missing)] }
        await sut.seedUnchecked('house-a', { ...project, revision: 1 }, [good, { ...broken, size: 5 }])
        const load = saved(await repo.load('house-a'))
        expect(load.snapshot.assets.map(a => a.name)).toEqual(['good.png'])
        expect(load.snapshot.project.assets.map(a => a.name)).toEqual(['good.png'])
        expect(load.skipped).toHaveLength(2)
        expect(load.skipped.join(' ')).toMatch(/broken\.png/)
        expect(load.skipped.join(' ')).toMatch(/missing\.png/)
      })
    })
  })
}
