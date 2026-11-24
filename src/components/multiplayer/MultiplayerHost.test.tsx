import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudError, type CloudBackend } from '../../cloud/backend'
import type { PlayerContext } from '../../cloud/player'
import { HIDDEN_APP_VIEW, emitAppState } from '../../lib/app-bridge'
import { HIDDEN_EDITOR_VIEW, emitEditorState } from '../../lib/editor-bridge'
import { multiplayerLink } from '../../lib/multiplayer-link'
import { MemoryHub } from '../../multiplayer/memory-hub.test-support'
import type { RealtimeTransport } from '../../multiplayer/transport'
import { MultiplayerHost } from './MultiplayerHost'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Stabilization B1, B2 and B4 in the host: a removed player is told so and offered their own town; changing
 * your look does not restart the live session; over an app, only what needs the player is shown.
 */

const WORLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ME = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'

let hub: MemoryHub
let opens: number
let member: boolean
let container: HTMLDivElement
let root: Root

const backend: CloudBackend = {
  async rpc<T>(fn: string): Promise<T> {
    if (fn !== 'list_world_members') throw new CloudError('42883', `no ${fn}`)
    if (!member) throw new CloudError('42501', 'You are not in that town.')
    return [ME, OTHER].map(id => ({ userId: id, displayName: id === ME ? 'Me' : 'Other', avatar: 'red-cap', role: 'resident', slot: null })) as T
  },
  upload: async () => undefined,
  download: async () => new ArrayBuffer(0),
  remove: async () => undefined,
}

const player = (avatar: string): PlayerContext => ({
  userId: ME,
  profile: { id: ME, displayName: 'Me', avatar, settings: {}, createdAt: '' },
  world: { id: WORLD, name: 'Town', role: 'resident' },
  houses: [],
  ownedSlot: null,
})

function transport(): RealtimeTransport {
  const client = hub.client(ME)
  return { open: (...args) => { opens++; return client.open(...args) } }
}

const settle = async (ms = 0): Promise<void> => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}
const statusLine = (): HTMLElement | null => container.querySelector('[data-testid="mp-status"]')

beforeEach(() => {
  vi.useFakeTimers()
  hub = new MemoryHub()
  opens = 0
  member = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  emitAppState(HIDDEN_APP_VIEW)
  emitEditorState(HIDDEN_EDITOR_VIEW)
  vi.useRealTimers()
})

describe('MultiplayerHost', () => {
  it('keeps the same live session when the player changes their look (no leave and rejoin)', async () => {
    const t = transport()
    act(() => root.render(<MultiplayerHost transport={t} backend={backend} player={player('red-cap')} />))
    await settle()
    expect(statusLine()?.dataset['status']).toBe('joined')
    const link = multiplayerLink()
    act(() => root.render(<MultiplayerHost transport={t} backend={backend} player={player('pink-cap')} />))
    await settle()
    expect(opens).toBe(1)
    expect(multiplayerLink()).toBe(link)
    expect(statusLine()?.dataset['status']).toBe('joined')
  })

  it('tells a player who was removed, and offers their own town', async () => {
    const onGoHome = vi.fn()
    act(() => root.render(<MultiplayerHost transport={transport()} backend={backend} player={player('red-cap')} onGoHome={onGoHome} />))
    await settle()
    expect(hub.subscribers(`world:${WORLD}`)).toBe(1)
    member = false
    act(() => multiplayerLink()!.membersChanged())
    await settle()
    expect(statusLine()?.dataset['status']).toBe('removed')
    expect(statusLine()?.textContent).toContain("You're no longer in this town.")
    expect(hub.subscribers(`world:${WORLD}`)).toBe(0)
    expect(container.querySelector('[aria-label="Emotes"]')).toBeNull()
    const goHome = [...container.querySelectorAll('button')].find(b => b.textContent === 'Go to my town')!
    act(() => goHome.click())
    expect(onGoHome).toHaveBeenCalledOnce()
  })

  it('steps aside over an app or the editor, except when the town or the connection is gone', async () => {
    act(() => root.render(<MultiplayerHost transport={transport()} backend={backend} player={player('red-cap')} />))
    await settle()
    expect(statusLine()).not.toBeNull()
    act(() => emitAppState({ open: 'website', houseId: 'house-a', mode: 'owner' }))
    expect(statusLine()).toBeNull()
    act(() => emitAppState(HIDDEN_APP_VIEW))
    expect(statusLine()).not.toBeNull()
    act(() => emitEditorState({ ...HIDDEN_EDITOR_VIEW, mode: 'edit' }))
    expect(statusLine()).toBeNull()
    act(() => emitEditorState(HIDDEN_EDITOR_VIEW))

    act(() => emitAppState({ open: 'paint', houseId: 'house-a', mode: 'owner' }))
    member = false
    act(() => multiplayerLink()!.membersChanged())
    await settle()
    expect(statusLine()?.dataset['status']).toBe('removed') // shown even over the app
  })
})
