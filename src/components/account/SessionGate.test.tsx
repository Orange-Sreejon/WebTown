import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudError, type CloudBackend } from '../../cloud/backend'
import { activeCloud } from '../../cloud/cloud-session'
import { FakeAuthServer } from '../../cloud/fake-auth.test-support'
import { canEditHouse } from '../../game/config/ownership'
import { HIDDEN_APP_VIEW, emitAppState } from '../../lib/app-bridge'
import { playerHouse } from '../../lib/player-identity'
import { savedLabel, storageWhere } from '../../personal-spaces/labels'
import { SessionGate, type Connection } from './SessionGate'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The database's side, as far as the gate needs it: bootstrap and profile updates, per user. */
function fakeBackend(): CloudBackend & { offline: boolean; profiles: Map<string, { displayName: string; settings: Record<string, unknown> }> } {
  const profiles = new Map<string, { displayName: string; settings: Record<string, unknown> }>()
  let current = ''
  const b = {
    offline: false,
    profiles,
    as(id: string) { current = id },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      if (b.offline) throw new CloudError('network', 'Failed to fetch')
      const id = current
      if (fn === 'bootstrap_player') {
        if (!profiles.has(id)) profiles.set(id, { displayName: `Resident ${id.slice(-4)}`, settings: {} })
        const p = profiles.get(id)!
        const world = id.replace(/^0/, 'a')
        return {
          profile: { id, displayName: p.displayName, avatar: 'villager', settings: p.settings, createdAt: '2026-11-21T10:00:00.000Z' },
          world: { id: world, name: 'My WebTown', kind: 'personal', role: 'owner' },
          houses: ['house-a', 'house-b'].map((slot, i) => ({ id: world.replace(/.$/, String(i)), slot, ownerId: slot === 'house-a' ? id : null })),
        } as T
      }
      if (fn === 'update_profile') {
        const p = profiles.get(id)!
        if (typeof args['p_display_name'] === 'string') p.displayName = args['p_display_name']
        if (args['p_settings']) p.settings = args['p_settings'] as Record<string, unknown>
        return { id, displayName: p.displayName, avatar: 'villager', settings: p.settings, createdAt: '' } as T
      }
      throw new CloudError('42883', `no function ${fn}`)
    },
    upload: async () => undefined,
    download: async () => new ArrayBuffer(0),
    remove: async () => undefined,
  }
  return b
}

let container: HTMLDivElement
let root: Root
let mounts = 0

/** Stands in for the game: shows what the game would read. */
function Game(): React.ReactElement {
  useEffect(() => { mounts++ }, [])
  return (
    <div data-testid="game">
      can-edit-house-a:{String(canEditHouse('house-a'))} owned:{String(playerHouse()?.ownedSlot ?? 'none')} label:{savedLabel(true)}
    </div>
  )
}

beforeEach(() => {
  mounts = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const text = (): string => container.textContent ?? ''
const findButton = (name: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name)
const button = (name: string): HTMLButtonElement => {
  const b = findButton(name)
  if (!b) throw new Error(`no button "${name}" in: ${text().slice(0, 300)}`)
  return b
}
const click = async (el: HTMLElement): Promise<void> => { act(() => el.click()); await settle() }
let lastInput: HTMLInputElement | null = null
function type(label: string, value: string): void {
  const input = [...container.querySelectorAll('label')].find(l => l.textContent?.startsWith(label))?.querySelector('input') as HTMLInputElement
  if (!input) throw new Error(`no field ${label}`)
  lastInput = input
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = async (): Promise<void> => {
  act(() => lastInput!.form!.requestSubmit())
  await settle()
}

async function mount(server: FakeAuthServer | null, backend = fakeBackend()): Promise<ReturnType<typeof fakeBackend>> {
  const connect = async (): Promise<Connection | null> => {
    if (!server) return null
    const auth = server.port()
    // The backend acts as whoever the auth server says is signed in, as a real session would.
    const original = backend.rpc.bind(backend)
    backend.rpc = async (fn, args) => { (backend as unknown as { as(id: string): void }).as(server.savedSession ?? ''); return original(fn, args) }
    return { auth, backend }
  }
  act(() => root.render(<SessionGate connect={connect} redirectTo="https://webtown.example/"><Game /></SessionGate>))
  await settle()
  return backend
}

describe('without a backend', () => {
  it('runs the game as before, on this device only, with no account control', async () => {
    await mount(null)
    expect(text()).toContain('can-edit-house-a:true')
    expect(text()).toContain('label:Saved on this device only')
    expect(findButton('Guest')).toBeUndefined()
    expect(activeCloud()).toBeNull()
  })
})

describe('a first visit', () => {
  it('starts as a guest at once, in their own house, saving to the guest account', async () => {
    const server = new FakeAuthServer()
    await mount(server)
    expect(server.users.size).toBe(1)
    expect(text()).toContain('can-edit-house-a:true owned:house-a label:Saved to your guest account')
    expect(text()).toContain('Guest · Save your progress')
    expect(activeCloud()?.player.ownedSlot).toBe('house-a')
  })

  it('brings the same guest back after a reload', async () => {
    const server = new FakeAuthServer()
    const backend = await mount(server)
    const first = server.savedSession
    act(() => root.unmount())
    root = createRoot(container)
    await mount(server, backend)
    expect(server.savedSession).toBe(first)
    expect(server.users.size).toBe(1)
    expect(text()).toContain('owned:house-a')
  })
})

describe('upgrading a guest', () => {
  it('links an email, waits for confirmation, sets a password, and keeps everything (same id, no restart)', async () => {
    const server = new FakeAuthServer()
    await mount(server)
    const guestId = server.savedSession
    const mountsBefore = mounts
    await click(button('Guest · Save your progress'))
    expect(text()).toContain("only this browser can open")
    type('Email', 'ada@example.com')
    await submit()
    expect(text()).toContain('We sent a link to ada@example.com')

    server.confirm('ada@example.com')
    await click(button("I've confirmed it"))
    expect(text()).toContain('Choose a password')
    type('New password (at least 8 characters)', 'correct horse')
    type('New password again', 'correct horse')
    await submit()
    expect(text()).toContain('Logged in as ada@example.com')
    expect(server.savedSession).toBe(guestId)
    expect(mounts).toBe(mountsBefore) // the game did not restart
    // Every window opened from now on says it is saved to the account (labels are read when a window opens).
    expect(storageWhere()).toBe('account')
    expect(savedLabel(true)).toBe('Saved to your WebTown account')
  })

  it('does not merge into an email that already has an account, and offers a careful log in instead', async () => {
    const server = new FakeAuthServer()
    const other = server.addAccount('taken@example.com', 'secret123')
    await mount(server)
    const guestId = server.savedSession
    await click(button('Guest · Save your progress'))
    type('Email', 'taken@example.com')
    await submit()
    expect(text()).toContain('That email already has a WebTown account.')
    expect(text()).toContain('neither is merged')
    expect(server.savedSession).toBe(guestId)

    await click(button('Log in to that account instead'))
    type('Password', 'secret123')
    expect(button('Log in').disabled).toBe(true) // the guest must accept leaving their progress first
    act(() => (container.querySelector('.ac-check input') as HTMLInputElement).click())
    await submit()
    expect(server.savedSession).toBe(other)
    expect(text()).toContain('Resident')
    expect(findButton('Guest · Save your progress')).toBeUndefined()
  })
})

describe('accounts', () => {
  it('logs out to the start screen, and back in to the same account', async () => {
    const server = new FakeAuthServer()
    const id = server.addAccount('me@example.com', 'password1')
    server.savedSession = id
    await mount(server)
    await click(button(`Resident ${id.slice(-4)}`))
    await click(button('Log out'))
    expect(text()).toContain('Play as guest')
    expect(findButton('Log in')).toBeDefined()
    expect(playerHouse()).toBeNull()
    expect(activeCloud()).toBeNull()

    await click(button('Log in'))
    type('Email', 'me@example.com')
    type('Password', 'password1')
    await submit()
    expect(server.savedSession).toBe(id)
    expect(text()).toContain('owned:house-a')
  })

  it('starts a fresh guest from the start screen', async () => {
    const server = new FakeAuthServer()
    await mount(server)
    const firstGuest = server.savedSession
    await click(button('Guest · Save your progress'))
    // A guest has no log-out button (it would lose everything); log in elsewhere ends the guest session.
    expect(findButton('Log out')).toBeUndefined()
    act(() => root.unmount())
    server.savedSession = null
    root = createRoot(container)
    await mount(server)
    expect(server.savedSession).not.toBe(firstGuest)
  })

  it('renames the player', async () => {
    const server = new FakeAuthServer()
    const backend = await mount(server)
    await click(button('Guest · Save your progress'))
    type('Your name in WebTown', 'Night Owl')
    act(() => container.querySelector<HTMLFormElement>('.ac-panel form')!.requestSubmit())
    await settle()
    expect(backend.profiles.get(server.savedSession!)?.displayName).toBe('Night Owl')
    expect(text()).toContain('Saved.')
  })
})

describe('when WebTown cannot be reached', () => {
  it('says so, retries, and offers to play on this device only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const server = new FakeAuthServer()
    const backend = fakeBackend()
    backend.offline = true
    await mount(server, backend)
    expect(text()).toContain("Couldn't reach WebTown")
    expect(container.querySelector('[data-testid="game"]')).toBeNull()

    await click(button('Play on this device only'))
    expect(text()).toContain('label:Saved on this device only')
    expect(text()).toContain('On this device only. Connect')

    backend.offline = false
    await click(button('On this device only. Connect'))
    expect(text()).toContain('label:Saved to your guest account')
  })
})

describe('the account control', () => {
  it('lets a guest hide the reminder, and remembers it in their profile', async () => {
    const server = new FakeAuthServer()
    const backend = await mount(server)
    await click(button('Guest · Save your progress'))
    await click(button('Hide the reminder on the Guest button'))
    expect(backend.profiles.get(server.savedSession!)?.settings).toMatchObject({ upgradeHintDismissed: true })
    await click(button('Close'))
    expect(findButton('Guest')).toBeDefined()
    expect(findButton('Guest · Save your progress')).toBeUndefined()
  })

  it('keeps typed keys away from the game while the panel is open', async () => {
    const server = new FakeAuthServer()
    await mount(server)
    await click(button('Guest · Save your progress'))
    const heard: string[] = []
    const onKey = (e: KeyboardEvent): void => void heard.push(e.key)
    window.addEventListener('keydown', onKey)
    const input = container.querySelector('.ac-panel input')!
    for (const key of ['w', 'a', 'E', ' ', 'ArrowLeft', 'Escape']) {
      act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
    }
    window.removeEventListener('keydown', onKey)
    expect(heard).toEqual(['Escape'])
  })

  it('steps aside while the website or the Sketchbook is open', async () => {
    const server = new FakeAuthServer()
    await mount(server)
    act(() => emitAppState({ open: 'paint', houseId: 'house-a', mode: 'owner' }))
    expect(findButton('Guest · Save your progress')).toBeUndefined()
    act(() => emitAppState(HIDDEN_APP_VIEW))
    expect(findButton('Guest · Save your progress')).toBeDefined()
  })
})
