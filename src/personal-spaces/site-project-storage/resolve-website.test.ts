import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSiteStorage, websiteAccessFor, type SiteStorage } from '../composition'
import { PermissionError } from '../errors'
import { MemorySiteRepository } from '../site-storage/memory-site-repository'
import { STORE_SITES } from '../storage/webtown-db'
import { IdbDatabase } from '../storage/idb'
import { WEBTOWN_DB } from '../storage/webtown-db'
import { createDefaultSite } from '../website/default-site'
import { guardProjectWriter } from './guarded-project-writer'
import { MemoryProjectRepository } from './memory-project-repository'
import { asset, projectWith, saveOf } from './project-repository.contract'
import { resolveWebsite } from './resolve-website'

const NOW = '2026-12-01T00:00:00.000Z'
const now = (): string => NOW

function legacySite(houseId: string) {
  const site = createDefaultSite(houseId, '2026-11-01T00:00:00.000Z')
  site.title = 'Ada’s corner'
  site.profile.displayName = 'Ada'
  site.about.body = 'I like <b>tags</b> & things.'
  return site
}

const opened: SiteStorage[] = []
afterEach(() => {
  for (const storage of opened.splice(0)) storage.close()
  vi.restoreAllMocks()
})
async function storage(factory = new IDBFactory() as unknown as IDBFactory): Promise<SiteStorage> {
  const s = await createSiteStorage({ factory, now })
  opened.push(s)
  return s
}

describe('resolveWebsite', () => {
  it('is nothing for a house that never saved anything', async () => {
    const projects = new MemoryProjectRepository()
    const legacy = new MemorySiteRepository()
    expect(await resolveWebsite('house-a', { projects, legacy, now })).toEqual({ kind: 'none' })
  })

  it('converts an old structured website in memory, and writes nothing', async () => {
    const projects = new MemoryProjectRepository()
    const legacy = new MemorySiteRepository()
    const old = await legacy.save(legacySite('house-a'))
    const state = await resolveWebsite('house-a', { projects, legacy, now })
    expect(state.kind).toBe('migrated')
    if (state.kind !== 'migrated') return
    const { project } = state.snapshot
    expect(project.revision).toBe(0)
    expect(project.title).toBe('Ada’s corner')
    expect(project.origin).toEqual({ kind: 'migrated', sourceUpdatedAt: old.updatedAt })
    expect(project.pages.map(p => p.name)).toEqual(['index.html', 'about.html', 'projects.html', 'links.html'])
    expect(project.pages[1]!.html).toContain('I like &lt;b&gt;tags&lt;/b&gt; &amp; things.')
    expect(await projects.load('house-a')).toEqual({ kind: 'none' })
    expect((await legacy.loadWithReport('house-a')).site).toEqual(old)
  })

  it('treats a damaged old website as nothing, and leaves it in place', async () => {
    const legacy = new MemorySiteRepository()
    legacy.seedUnchecked('house-a', { houseId: 'house-a', title: 42 })
    expect(await resolveWebsite('house-a', { projects: new MemoryProjectRepository(), legacy, now })).toEqual({ kind: 'none' })
  })

  it('prefers a saved HTML/CSS website over the old one', async () => {
    const projects = new MemoryProjectRepository()
    const legacy = new MemorySiteRepository()
    await legacy.save(legacySite('house-a'))
    await projects.save(saveOf(projectWith('house-a', [], { css: 'mine' }), 0))
    const state = await resolveWebsite('house-a', { projects, legacy, now })
    expect(state.kind === 'project' && state.snapshot.project.css).toBe('mine')
  })

  it('reports a damaged HTML/CSS website with the revision to save over', async () => {
    const projects = new MemoryProjectRepository()
    projects.seedRaw('house-a', { revision: 3 })
    expect(await resolveWebsite('house-a', { projects, legacy: new MemorySiteRepository(), now }))
      .toMatchObject({ kind: 'damaged', revision: 3 })
  })

  it('migrates from real version 1 storage, and the first save keeps the old record untouched', async () => {
    const factory = new IDBFactory() as unknown as IDBFactory
    const v1 = new IdbDatabase({ name: WEBTOWN_DB.name, version: 1, upgrade: raw => void raw.createObjectStore(STORE_SITES, { keyPath: 'houseId' }) }, { factory })
    const legacy = await new MemorySiteRepository().save(legacySite('house-a'))
    await v1.put(STORE_SITES, legacy)
    v1.close()

    const s = await storage(factory)
    const access = websiteAccessFor({ houseId: 'house-a', mode: 'owner' }, s, now)
    const state = await access.open()
    expect(state.kind).toBe('migrated')
    if (state.kind !== 'migrated' || access.mode !== 'owner') return
    await access.writer.save(saveOf(state.snapshot.project, 0))
    expect((await access.open()).kind).toBe('project')
    expect((await s.repository.loadWithReport('house-a')).site).toEqual(legacy)
  })
})

describe('websiteAccessFor', () => {
  it('gives a visitor no way to save', async () => {
    const s = await storage()
    const access = websiteAccessFor({ houseId: 'house-a', mode: 'visitor' }, s, now)
    expect(access.mode).toBe('visitor')
    expect('writer' in access).toBe(false)
    expect(await access.open()).toEqual({ kind: 'none' })
  })

  it('treats anything but exactly owner as a visitor', () => {
    const s = { repository: new MemorySiteRepository(), projects: new MemoryProjectRepository() }
    expect(websiteAccessFor({ houseId: 'house-a', mode: 'Owner' as never }, s).mode).toBe('visitor')
  })

  it("lets the owner save only their own house's website", async () => {
    const s = await storage()
    const access = websiteAccessFor({ houseId: 'house-a', mode: 'owner' }, s, now)
    if (access.mode !== 'owner') throw new Error('expected owner access')
    await expect(access.writer.save(saveOf(projectWith('house-b'), 0))).rejects.toBeInstanceOf(PermissionError)
    const saved = await access.writer.save(saveOf(projectWith('house-a'), 0))
    expect(saved.revision).toBe(1)
    const visitor = websiteAccessFor({ houseId: 'house-a', mode: 'visitor' }, s, now)
    expect((await visitor.open()).kind).toBe('project')
  })

  it('falls back to memory, and says so, when the browser has no storage', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const s = await createSiteStorage({ factory: undefined, now })
    expect(s.persistent).toBe(false)
    const access = websiteAccessFor({ houseId: 'house-a', mode: 'owner' }, s, now)
    if (access.mode !== 'owner') throw new Error('expected owner access')
    await access.writer.save(saveOf(projectWith('house-a'), 0))
    expect((await access.open()).kind).toBe('project')
  })
})

describe('guardProjectWriter', () => {
  const inner = () => new MemoryProjectRepository()

  it('refuses anything but exactly owner', async () => {
    for (const mode of ['visitor', 'OWNER', undefined, null]) {
      const writer = guardProjectWriter(inner(), { houseId: 'house-a', mode: mode as never })
      await expect(writer.save(saveOf(projectWith('house-a'), 0))).rejects.toBeInstanceOf(PermissionError)
    }
  })

  it('refuses an image for another house hidden in an otherwise good save', async () => {
    const writer = guardProjectWriter(inner(), { houseId: 'house-a', mode: 'owner' })
    const stray = asset('house-b', 'id-1', 'x.png')
    await expect(writer.save(saveOf(projectWith('house-a', [stray]), 0, [stray]))).rejects.toBeInstanceOf(PermissionError)
  })

  it('refuses when the window has no house', async () => {
    const writer = guardProjectWriter(inner(), { houseId: '', mode: 'owner' })
    await expect(writer.save(saveOf(projectWith('house-a'), 0))).rejects.toBeInstanceOf(PermissionError)
  })
})
