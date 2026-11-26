import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  displayNameOr, grantModerator, hallContext, listHallModerators, listModerationLog, parseHallContext, revokeModerator,
} from './community'
import type { CloudBackend } from './backend'
import { testBackend } from './database/test-backend.test-support'
import { TestDatabase, type Caller } from './database/test-database.test-support'
import { PermissionError, StorageError, ValidationError } from '../personal-spaces/errors'

/** The CH-01 client calls against the real database (PGlite with every migration), as each user would make them. */

let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

async function person(name: string): Promise<{ caller: Caller & { kind: 'user' }; backend: CloudBackend; world: string }> {
  const caller = await db.createUser()
  const boot = await db.rpc<{ world: { id: string } }>(caller, 'bootstrap_player', { p_display_name: name })
  return { caller, backend: testBackend(db, caller), world: boot.world.id }
}

describe('Community Hall client', () => {
  it('reads the Hall and roles, appoints and removes moderators, and reads the log', async () => {
    const owner = await person('Owner')
    const ada = await person('Ada')
    const code = (await db.rpc<{ code: string }>(owner.caller, 'create_world_invite', { p_world: owner.world, p_days: 1 })).code
    await db.rpc(ada.caller, 'join_world', { p_code: code })
    const W = owner.world

    expect(await hallContext(owner.backend, W)).toEqual({ worldId: W, name: 'Community Hall', canvasLocked: false, draftLocked: false, role: 'owner' })
    expect((await hallContext(ada.backend, W)).role).toBe('member')

    await grantModerator(owner.backend, W, ada.caller.id, 'Keeps things tidy')
    expect((await hallContext(ada.backend, W)).role).toBe('moderator')
    expect((await listHallModerators(ada.backend, W)).map(m => [m.displayName, m.isOwner])).toEqual([['Owner', true], ['Ada', false]])

    const entries = await listModerationLog(ada.backend, W)
    expect(entries).toEqual([expect.objectContaining({
      action: 'grant_moderator', target: { userId: ada.caller.id }, reason: 'Keeps things tidy',
      actorId: owner.caller.id, actorName: 'Owner', targetName: 'Ada',
    })])

    await revokeModerator(owner.backend, W, ada.caller.id)
    expect((await hallContext(ada.backend, W)).role).toBe('member')
    expect((await listModerationLog(owner.backend, W, { limit: 1 }))[0]!.action).toBe('revoke_moderator')
  })

  it("turns the database's refusals into the app's own errors", async () => {
    const owner = await person('Owner')
    const stranger = await person('Stranger')
    await expect(hallContext(stranger.backend, owner.world)).rejects.toBeInstanceOf(PermissionError)
    await expect(grantModerator(stranger.backend, owner.world, stranger.caller.id)).rejects.toBeInstanceOf(PermissionError)
    await expect(grantModerator(owner.backend, owner.world, stranger.caller.id)).rejects.toBeInstanceOf(ValidationError)
    await expect(listModerationLog(owner.backend, owner.world, { limit: 500 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses malformed answers instead of showing them', () => {
    for (const raw of [null, [], { worldId: 'x' }, { worldId: crypto.randomUUID(), name: 'H', canvasLocked: 'no', draftLocked: false, role: 'owner' },
      { worldId: crypto.randomUUID(), name: 'H', canvasLocked: false, draftLocked: false, role: 'admin' }]) {
      expect(() => parseHallContext(raw), JSON.stringify(raw)).toThrow(StorageError)
    }
  })

  it('shows people who left as "a former member"', () => {
    expect(displayNameOr(null)).toBe('a former member')
    expect(displayNameOr('Ada')).toBe('Ada')
  })
})
