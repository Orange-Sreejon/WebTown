import { describe, expect, it, vi } from 'vitest'
import type { AccessMode } from '../../lib/app-bridge'
import { PermissionError } from '../errors'
import { createDefaultSite } from '../website/default-site'
import type { SiteWriter } from '../website/site-repository'
import type { SiteContent } from '../website/site-types'
import { guardSiteWriter } from './guarded-site-writer'

const site = (houseId: string): SiteContent => createDefaultSite(houseId, '2026-11-16T00:00:00.000Z')

function inner(): SiteWriter & { save: ReturnType<typeof vi.fn> } {
  return { save: vi.fn(async (s: SiteContent) => s) }
}

const refusal = async (promise: Promise<unknown>): Promise<PermissionError> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(PermissionError)
    return error as PermissionError
  }
  throw new Error('expected a PermissionError')
}

describe('guardSiteWriter', () => {
  it('lets the owner save the website of the house the window was opened for', async () => {
    const writer = inner()
    const guarded = guardSiteWriter(writer, { houseId: 'house-a', mode: 'owner' })
    const mine = site('house-a')
    await expect(guarded.save(mine)).resolves.toBe(mine)
    expect(writer.save).toHaveBeenCalledTimes(1)
    expect(writer.save).toHaveBeenCalledWith(mine)
  })

  it('refuses a visitor, and never calls the writer', async () => {
    const writer = inner()
    const error = await refusal(guardSiteWriter(writer, { houseId: 'house-a', mode: 'visitor' }).save(site('house-a')))
    expect(error.code).toBe('permission')
    expect(error.message).toContain('owner')
    expect(writer.save).not.toHaveBeenCalled()
  })

  it('refuses the owner of one house writing another house’s website', async () => {
    const writer = inner()
    const guarded = guardSiteWriter(writer, { houseId: 'house-a', mode: 'owner' })
    const error = await refusal(guarded.save(site('house-b')))
    expect(error.message).toContain('different house')
    expect(writer.save).not.toHaveBeenCalled()
  })

  it.each(['admin', 'OWNER', 'Owner', '', undefined, null, true, 1])(
    'fails closed on the unknown mode %j',
    async mode => {
      const writer = inner()
      const guarded = guardSiteWriter(writer, { houseId: 'house-a', mode: mode as unknown as AccessMode })
      await refusal(guarded.save(site('house-a')))
      expect(writer.save).not.toHaveBeenCalled()
    },
  )

  it.each(['', undefined, null, 7])('fails closed when the window has no usable house (%j)', async houseId => {
    const writer = inner()
    const guarded = guardSiteWriter(writer, { houseId: houseId as unknown as string, mode: 'owner' })
    await refusal(guarded.save(site('house-a')))
    await refusal(guarded.save({ ...site('house-a'), houseId: '' }))
    expect(writer.save).not.toHaveBeenCalled()
  })

  it('refuses a missing or damaged site instead of throwing something else', async () => {
    const writer = inner()
    const guarded = guardSiteWriter(writer, { houseId: 'house-a', mode: 'owner' })
    await refusal(guarded.save(undefined as unknown as SiteContent))
    await refusal(guarded.save(null as unknown as SiteContent))
    expect(writer.save).not.toHaveBeenCalled()
  })

  it('cannot be talked into a different house by changing the grant afterwards', async () => {
    const writer = inner()
    const grant = { houseId: 'house-a', mode: 'owner' as AccessMode }
    const guarded = guardSiteWriter(writer, grant)
    grant.houseId = 'house-b'
    grant.mode = 'visitor'
    await expect(guarded.save(site('house-a'))).resolves.toBeDefined()
    await refusal(guarded.save(site('house-b')))
  })

  it('passes the writer’s own errors through untouched', async () => {
    const failing: SiteWriter = { save: async () => { throw new Error('disk full') } }
    const guarded = guardSiteWriter(failing, { houseId: 'house-a', mode: 'owner' })
    await expect(guarded.save(site('house-a'))).rejects.toThrow('disk full')
  })

  it('exposes nothing but save', () => {
    const guarded = guardSiteWriter(inner(), { houseId: 'house-a', mode: 'owner' })
    expect(Object.keys(guarded)).toEqual(['save'])
  })
})
