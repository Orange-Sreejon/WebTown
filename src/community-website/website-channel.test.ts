import { describe, expect, it } from 'vitest'
import { MemoryHub } from '../multiplayer/memory-hub.test-support'
import { WebsiteChannel, editorsIn, type WebsiteHint } from './website-channel'

const WORLD = '0b6c1c4e-8f0e-4c7e-9d7a-000000000001'
const ADA = '0b6c1c4e-8f0e-4c7e-9d7a-00000000000a'
const BO = '0b6c1c4e-8f0e-4c7e-9d7a-00000000000b'
const tick = () => new Promise(r => setTimeout(r, 0))

describe('editorsIn', () => {
  it('lists other users whose presence says they are editing, ignoring junk', () => {
    const state = new Map<string, unknown[]>([
      ['k1', [{ user: BO, editing: true }]],
      ['k2', [{ user: ADA, editing: true }]], // me
      ['k3', [{ user: 'not-a-user', editing: true }, { user: BO, editing: 'yes' }, null, 'x']],
      ['k4', [{ user: BO, editing: true }]], // Bo in a second tab: once
    ])
    expect(editorsIn(state, ADA)).toEqual([BO])
  })
})

describe('WebsiteChannel', () => {
  it("shows who is editing on the Hall channel, and passes on valid hints only", async () => {
    const hub = new MemoryHub()
    const ada = new WebsiteChannel({ transport: hub.client(ADA), worldId: WORLD, userId: ADA })
    const bo = new WebsiteChannel({ transport: hub.client(BO), worldId: WORLD, userId: BO })
    const seen: string[][] = []
    const hints: WebsiteHint[] = []
    ada.onEditors(ids => seen.push(ids))
    ada.onHint(h => hints.push(h))
    ada.start()
    bo.start()
    await tick()
    expect(ada.editors).toEqual([])
    bo.setEditing(true)
    expect(ada.editors).toEqual([BO])
    bo.setEditing(false)
    expect(seen).toEqual([[BO], []])

    hub.inject(`hall:${WORLD}`, 'website', { kind: 'draft', number: 4 })
    for (const junk of [null, { kind: 'draft' }, { kind: 'x', number: 1 }, { kind: 'published', number: -1 }]) hub.inject(`hall:${WORLD}`, 'website', junk)
    expect(hints).toEqual([{ kind: 'draft', number: 4 }])

    bo.stop()
    ada.stop()
    expect(hub.subscribers(`hall:${WORLD}`)).toBe(0)
  })
})
