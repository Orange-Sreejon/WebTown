import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CloudError, type CloudBackend } from '../../cloud/backend'
import { activeCloud } from '../../cloud/cloud-session'
import { DatabaseError, TestDatabase } from '../../cloud/database/test-database.test-support'
import { FakeAuthServer } from '../../cloud/fake-auth.test-support'
import { playerHouse } from '../../lib/player-identity'
import { SessionGate, type Connection } from '../account/SessionGate'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Invitations and towns through the real session gate and the real database (PGlite with every migration):
 * an owner invites from the town window, a second player opens the link, joins and plays in that town, the
 * choice is remembered, and leaving or being removed brings them back to their own town.
 */

let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

const server = new FakeAuthServer()
const known = new Set<string>()

/** The backend as whoever is signed in on the fake auth server, against the real database. */
const backend: CloudBackend = {
  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = server.savedSession
    if (!id) throw new CloudError('42501', 'Sign in first.')
    if (!known.has(id)) {
      await db.superuser('insert into auth.users (id, is_anonymous) values ($1, true) on conflict do nothing', [id])
      known.add(id)
    }
    try {
      return await db.rpc<T>({ kind: 'user', id, anonymous: true }, fn, args)
    } catch (error) {
      if (error instanceof DatabaseError) throw new CloudError(error.code, error.message, error)
      throw error
    }
  },
  upload: async () => undefined,
  download: async () => new ArrayBuffer(0),
  remove: async () => undefined,
}

let container: HTMLDivElement
let root: Root | null = null

function Game(): React.ReactElement {
  return <div data-testid="game">world:{activeCloud()?.player.world.id ?? 'none'} owned:{playerHouse()?.ownedSlot ?? 'none'}</div>
}

const settle = async (rounds = 30): Promise<void> => {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const text = (): string => container.textContent ?? ''
const button = (name: string | RegExp): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find(b => (typeof name === 'string' ? b.textContent === name : name.test(b.textContent ?? '')))
const click = async (name: string | RegExp): Promise<void> => {
  const b = button(name)
  if (!b) throw new Error(`no button ${String(name)} in: ${text()}`)
  await act(async () => { b.click() })
  await settle()
}
async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await settle(5)
  }
  throw new Error(`timed out waiting for ${what}; page: ${text()}`)
}

/** Opens WebTown as `session` (null: a new guest), at `search`. */
async function open(session: string | null, search = ''): Promise<string> {
  root?.unmount()
  window.history.replaceState(null, '', `/${search}`)
  server.savedSession = session
  root = createRoot(container)
  const connect = async (): Promise<Connection> => ({ auth: server.port(), backend })
  act(() => root!.render(<SessionGate connect={connect} redirectTo="https://webtown.example/"><Game /></SessionGate>))
  await until(() => /world:|Join|invitation|expired|full/i.test(text()), 'the gate')
  return server.savedSession!
}

async function ownerInvites(): Promise<{ owner: string; ownerWorld: string; code: string }> {
  const owner = await open(null)
  await until(() => text().includes('world:'), 'the game')
  const ownerWorld = activeCloud()!.player.world.id
  await click(/^Town: /)
  await until(() => !!button('Create invitation'), 'the town window')
  await click('Create invitation')
  await until(() => !!container.querySelector('[data-testid="invite-code"]'), 'the code')
  const code = container.querySelector('[data-testid="invite-code"]')!.textContent!
  const link = (container.querySelector('input[aria-label="Invitation link"]') as HTMLInputElement).value
  expect(link).toBe(`https://webtown.example/?invite=${code}`)
  return { owner, ownerWorld, code }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  window.localStorage.clear()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

describe('inviting and joining', () => {
  it('lets a second player join from the link, play in that town with their own house, and come back to it', async () => {
    const { ownerWorld, code } = await ownerInvites()

    const guest = await open(null, `?invite=${code}`)
    await until(() => text().includes('Join My WebTown?'), 'the invitation')
    expect(text()).toContain('1 of 7 players')
    expect(window.location.search).toBe('')
    await click('Join')
    await until(() => text().includes(`world:${ownerWorld}`), "the owner's town")
    expect(text()).toContain('owned:house-b')
    expect(button(/^Town: /)).toBeDefined()

    // A reload opens the same town.
    await open(guest)
    await until(() => text().includes(`world:${ownerWorld}`), 'the remembered town')

    // Both are listed in the town window.
    await click(/^Town: /)
    await until(() => text().includes('2 of 7 players'), 'the member list')
    expect(text()).toContain('(you)')
    expect(text()).toContain('· owner')
    expect(button('Create invitation')).toBeUndefined()

    // Going home and back.
    await click(/^Go to My WebTown$/)
    await until(() => text().includes('world:') && !text().includes(ownerWorld), 'their own town')
    expect(text()).toContain('owned:house-a')
  })

  it('says so for an unknown code and opens the player\'s own town', async () => {
    await open(null, '?invite=AAAA-BBBB-CCCC')
    await until(() => text().includes("This invitation doesn't work"), 'the refusal')
    await click('Open my town')
    await until(() => text().includes('owned:house-a'), 'their own town')
  })

  it('refuses a revoked invitation', async () => {
    const { code } = await ownerInvites()
    await until(() => !!button(/^Revoke /), 'the invitation list')
    await click(/^Revoke /)
    await open(null, `?invite=${code}`)
    await until(() => text().includes("This invitation doesn't work"), 'the refusal')
  })

  it('says when the link could not be copied (no clipboard), and confirms when it was', async () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('NotAllowedError')) } })
      await ownerInvites()
      await click('Copy link')
      expect(text()).toContain("Couldn't copy here. Select the link above and copy it.")
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } })
      await click('Copy link')
      expect(button('Copied')).toBeDefined()
      expect(text()).not.toContain("Couldn't copy here")
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
      else delete (navigator as { clipboard?: unknown }).clipboard
    }
  })

  it('lets a resident leave, after a warning, and opens their own town', async () => {
    const { ownerWorld, code } = await ownerInvites()
    await open(null, `?invite=${code}`)
    await until(() => !!button('Join'), 'the invitation')
    await click('Join')
    await until(() => text().includes(`world:${ownerWorld}`), "the owner's town")
    await click(/^Town: /)
    await until(() => !!button('Leave this town'), 'the town window')
    await click('Leave this town')
    expect(text()).toContain('will be deleted')
    await click('Leave and delete my house there')
    await until(() => text().includes('owned:house-a') && !text().includes(ownerWorld), 'their own town')
  })

  it('opens the player\'s own town, with a note, after the owner removed them', async () => {
    const { owner, ownerWorld, code } = await ownerInvites()
    const guest = await open(null, `?invite=${code}`)
    await until(() => !!button('Join'), 'the invitation')
    await click('Join')
    await until(() => text().includes(`world:${ownerWorld}`), "the owner's town")

    await open(owner)
    await click(/^Town: /)
    await until(() => !!button(/^Remove /), 'the member list')
    // B3: removing deletes their house, so it asks first; "Keep" changes nothing.
    await click(/^Remove /)
    expect(text()).toContain('will be deleted')
    await click(/^Keep /)
    expect(text()).toContain('2 of 7 players')
    expect(button('Remove and delete their house')).toBeUndefined()
    await click(/^Remove /)
    await click('Remove and delete their house')
    await until(() => text().includes('1 of 7 players'), 'the removal')

    await open(guest)
    await until(() => text().includes('owned:house-a'), 'their own town')
    expect(text()).toContain("You're no longer in that town")
  })
})
