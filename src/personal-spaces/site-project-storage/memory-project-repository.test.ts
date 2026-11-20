import { describe, expect, it } from 'vitest'
import { MemoryProjectRepository } from './memory-project-repository'
import { describeProjectRepositoryContract, projectWith, saveOf } from './project-repository.contract'
import type { SiteAsset } from '../site-project/types'

describeProjectRepositoryContract('MemoryProjectRepository', {
  async create(now) {
    const repository = new MemoryProjectRepository({ now })
    return {
      repository,
      seedUnchecked: async (houseId, project, assets = []) => repository.seedRaw(houseId, project, assets as SiteAsset[]),
    }
  },
})

describe('MemoryProjectRepository', () => {
  it('starts empty each time', async () => {
    await new MemoryProjectRepository().save(saveOf(projectWith('house-a'), 0))
    expect(await new MemoryProjectRepository().load('house-a')).toEqual({ kind: 'none' })
  })
})
