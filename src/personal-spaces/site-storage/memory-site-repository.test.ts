import { describe, expect, it } from 'vitest'
import { createDefaultSite } from '../website/default-site'
import { MemorySiteRepository } from './memory-site-repository'
import { describeSiteRepositoryContract, steppingClock } from './site-repository.contract'
import type { SiteLoadReport } from './site-record'

describeSiteRepositoryContract('MemorySiteRepository', {
  async create(now) {
    const reports: SiteLoadReport[] = []
    const repository = new MemorySiteRepository({ now, onLoad: report => reports.push(report) })
    return {
      repository,
      reports,
      seedUnchecked: async (houseId, raw) => repository.seedUnchecked(houseId, raw),
    }
  },
})

describe('MemorySiteRepository', () => {
  it('does not show a record that belongs to a different house', async () => {
    const reports: SiteLoadReport[] = []
    const repository = new MemorySiteRepository({ onLoad: report => reports.push(report) })
    // Filed under house-a, but the record says house-b: the key and the record disagree.
    repository.seedUnchecked('house-a', createDefaultSite('house-b', '2026-11-16T00:00:00.000Z'))
    expect((await repository.load('house-a')).title).toBe('Welcome to House A!')
    expect(reports[0]).toMatchObject({ origin: 'recovered', problems: ['The saved website belongs to a different house.'] })
  })

  it('forgets everything when it is thrown away, as a reload does', async () => {
    const first = new MemorySiteRepository({ now: steppingClock() })
    await first.save({ ...createDefaultSite('house-a', '2026-11-16T00:00:00.000Z'), title: 'Gone soon' })
    expect((await first.load('house-a')).title).toBe('Gone soon')

    const afterReload = new MemorySiteRepository({ now: steppingClock() })
    expect((await afterReload.load('house-a')).title).toBe('Welcome to House A!')
  })

  it('works with the real clock when none is given', async () => {
    const repository = new MemorySiteRepository()
    const saved = await repository.save(createDefaultSite('house-a', '2026-11-16T00:00:00.000Z'))
    expect(Date.now() - Date.parse(saved.updatedAt)).toBeLessThan(5000)
  })
})
