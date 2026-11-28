import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDatabase, type Caller } from '../../cloud/database/test-database.test-support'
import { testBackend } from '../../cloud/database/test-backend.test-support'
import { ModerationPanel, type ModerationTab } from './ModerationPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The moderation panel (CH-07) on the real database functions (PGlite), as the owner, a moderator and a member. */

type User = Caller & { kind: 'user' }
let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

interface Panel { container: HTMLDivElement; root: Root; onLocksChanged: ReturnType<typeof vi.fn> }
const panels: Panel[] = []
afterEach(() => {
  for (const p of panels.splice(0)) {
    act(() => p.root.unmount())
    p.container.remove()
  }
})

async function player(name: string): Promise<{ me: User; world: string }> {
  const me = await db.createUser()
  const boot = await db.rpc<{ world: { id: string } }>(me, 'bootstrap_player', { p_display_name: name })
  return { me, world: boot.world.id }
}
async function town(): Promise<{ owner: User; a: User; b: User; world: string }> {
  const { me: owner, world } = await player('Owner')
  const { me: a } = await player('Ada')
  const { me: b } = await player('Bo')
  const inv = await db.rpc<{ code: string }>(owner, 'create_world_invite', { p_world: world, p_days: 1 })
  await db.rpc(a, 'join_world', { p_code: inv.code })
  await db.rpc(b, 'join_world', { p_code: inv.code })
  return { owner, a, b, world }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
}
const until = async (check: () => void): Promise<void> => {
  await vi.waitFor(async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }); check() }, { timeout: 5000, interval: 20 })
}
async function open(me: User, world: string, tab: ModerationTab = 'log'): Promise<Panel> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onLocksChanged = vi.fn()
  act(() => root.render(<ModerationPanel backend={testBackend(db, me)} worldId={world} userId={me.id} onClose={vi.fn()} onLocksChanged={onLocksChanged} initialTab={tab} />))
  const p = { container, root, onLocksChanged }
  panels.push(p)
  await settle()
  return p
}
const text = (p: Panel): string => p.container.textContent ?? ''
const buttons = (p: Panel, name: string): HTMLButtonElement[] => [...p.container.querySelectorAll('button')].filter(b => b.textContent?.trim() === name)
const click = async (p: Panel, name: string, index = 0): Promise<void> => {
  const b = buttons(p, name)[index]
  if (!b) throw new Error(`no button "${name}" in: ${text(p).slice(0, 300)}`)
  act(() => b.click())
  await settle()
}
function type(el: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const note = (p: Panel): HTMLInputElement => p.container.querySelector('.mod-note input')!
const memberRow = (p: Panel, name: string): HTMLLIElement => [...p.container.querySelectorAll('li')].find(li => li.textContent?.startsWith(name))!

describe('the moderation panel', { timeout: 30_000 }, () => {
  it('lets the owner appoint and remove moderators, logged in words with the note', async () => {
    const { owner, world } = await town()
    const p = await open(owner, world, 'moderators')
    await until(() => expect(text(p)).toContain('Owner (owner of the town) (you)'))
    expect(buttons(p, 'Make moderator')).toHaveLength(2)
    type(note(p), 'Helps a lot')
    act(() => memberRow(p, 'Ada').querySelector('button')!.click())
    await until(() => expect(text(p)).toContain('Ada is now a moderator.'))
    expect(buttons(p, 'Make moderator')).toHaveLength(1)
    expect(buttons(p, 'Remove as moderator')).toHaveLength(1)
    await click(p, 'Log')
    await until(() => expect(text(p)).toContain('Owner made Ada a moderator.'))
    expect(text(p)).toContain('Note: Helps a lot')
    await click(p, 'Moderators')
    await until(() => expect(buttons(p, 'Remove as moderator')).toHaveLength(1))
    await click(p, 'Remove as moderator')
    await until(() => expect(text(p)).toContain('Ada is no longer a moderator.'))
  })

  it('shows a moderator who moderates, without letting them appoint anyone', async () => {
    const { owner, a, world } = await town()
    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: a.id })
    const p = await open(a, world, 'moderators')
    await until(() => expect(text(p)).toContain('Ada (you)'))
    expect(text(p)).toContain("Only the town's owner appoints and removes moderators.")
    expect(buttons(p, 'Make moderator')).toEqual([])
    expect(buttons(p, 'Remove as moderator')).toEqual([])
  })

  it('locks and unlocks the canvas and the draft, and tells the window', async () => {
    const { owner, world } = await town()
    const p = await open(owner, world, 'locks')
    await until(() => expect(text(p)).toContain('The canvas: open to everyone in town'))
    await click(p, 'Lock the canvas')
    await until(() => expect(text(p)).toContain('The canvas: locked'))
    expect(p.onLocksChanged).toHaveBeenCalledTimes(1)
    await click(p, 'Lock the draft')
    await until(() => expect(text(p)).toContain("The Community Website's draft: locked"))
    expect(await db.superuser('select canvas_locked, draft_locked from public.community_halls where world_id = $1', [world])).toEqual([{ canvas_locked: true, draft_locked: true }])
    await click(p, 'Unlock the canvas')
    await until(() => expect(text(p)).toContain('The canvas: open to everyone in town'))
  })

  it('brings back a drawing a moderator removed, from the log', async () => {
    const { owner, b, world } = await town()
    const id = crypto.randomUUID()
    await db.rpc(b, 'add_canvas_stroke', { p_world: world, p_id: id, p_tool: 'pen', p_color: '#000000', p_width: 2, p_points: [0, 0, 5, 5] })
    await db.rpc(owner, 'hide_canvas_stroke', { p_world: world, p_id: id, p_reason: 'moderated', p_note: 'Rude' })
    const p = await open(owner, world)
    await until(() => expect(text(p)).toContain('Owner removed a drawing by Bo.'))
    expect(text(p)).toContain('Note: Rude')
    await click(p, 'Bring back')
    await until(() => expect(text(p)).toContain('The drawing is back on the canvas.'))
    expect(await db.superuser('select hidden_at from public.canvas_strokes where id = $1', [id])).toEqual([{ hidden_at: null }])
    // The log now says so too; the older entry's button finds it already back.
    await until(() => expect(text(p)).toContain('Owner brought back a drawing by Bo.'))
    await click(p, 'Bring back')
    await until(() => expect(text(p)).toContain('That drawing is already on the canvas.'))
  })

  it('pages through a long log', async () => {
    const { owner, a, world } = await town()
    for (let i = 0; i < 18; i++) {
      await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: a.id })
      await db.rpc(owner, 'revoke_moderator', { p_world: world, p_user: a.id })
    }
    const p = await open(owner, world)
    await until(() => expect(p.container.querySelectorAll('.mod-log li')).toHaveLength(30))
    await click(p, 'Older')
    await until(() => expect(p.container.querySelectorAll('.mod-log li')).toHaveLength(36))
    expect(buttons(p, 'Older')).toEqual([])
  })

  it("shows a member the database's refusal, not the log", async () => {
    const { b, world } = await town()
    const p = await open(b, world)
    await until(() => expect(text(p)).toContain('Only moderators can read the moderation log.'))
  })
})
