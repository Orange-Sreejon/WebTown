import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDatabase, type Caller } from '../../cloud/database/test-database.test-support'
import { FileStore, testBackend } from '../../cloud/database/test-backend.test-support'
import { MemoryHub } from '../../multiplayer/memory-hub.test-support'
import { PlainEditor } from '../website-studio/plain-editor.test-support'
import { CommunityWebsiteApp } from './CommunityWebsiteApp'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The Community Website window (CH-06) on the real database functions and Storage policies (PGlite), with an
 * in-memory realtime hub to which the database's own announcements are relayed, as Supabase Realtime would.
 * Several players are several windows, each acting as its own user.
 */

type User = Caller & { kind: 'user' }
const NOW = '2026-12-26T09:00:00.000Z'

let db: TestDatabase
let hub: MemoryHub
let relayed = 0
let relay: ReturnType<typeof setInterval>
beforeAll(async () => {
  db = await TestDatabase.create()
  hub = new MemoryHub()
  relay = setInterval(() => {
    void db.superuser<{ id: number; topic: string; event: string; payload: unknown }>(
      'select id, topic, event, payload from realtime.messages where event is not null and id > $1 order by id', [relayed],
    ).then(rows => { for (const r of rows) { relayed = Math.max(relayed, r.id); hub.inject(r.topic, r.event, r.payload) } })
  }, 15)
}, 60_000)
afterAll(async () => {
  clearInterval(relay)
  await db.close()
})

interface Window { container: HTMLDivElement; root: Root; onClosed: ReturnType<typeof vi.fn> }
const windows: Window[] = []
afterEach(() => {
  for (const w of windows.splice(0)) {
    act(() => w.root.unmount())
    w.container.remove()
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

const files = new FileStore()
async function open(me: User, world: string): Promise<Window> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onClosed = vi.fn()
  act(() => root.render(
    <CommunityWebsiteApp transport={hub.client(me.id)} backend={testBackend(db, me, files)} worldId={world} userId={me.id} onClosed={onClosed} Editor={PlainEditor} now={() => NOW} />,
  ))
  const w = { container, root, onClosed }
  windows.push(w)
  await settle()
  return w
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
}
const until = async (check: () => void, timeout = 5000): Promise<void> => {
  await vi.waitFor(async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }); check() }, { timeout, interval: 20 })
}
const text = (w: Window): string => w.container.textContent ?? ''
const findButton = (w: Window, name: string): HTMLButtonElement | undefined =>
  [...w.container.querySelectorAll('button')].find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name || b.querySelector('strong')?.textContent === name)
const button = (w: Window, name: string): HTMLButtonElement => {
  const b = findButton(w, name)
  if (!b) throw new Error(`no button "${name}" in: ${text(w).slice(0, 300)}`)
  return b
}
const click = async (w: Window, name: string): Promise<void> => {
  act(() => button(w, name).click())
  await settle()
}
function type(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const editor = (w: Window): HTMLTextAreaElement => w.container.querySelector('textarea')!
const draftNumber = async (world: string) =>
  (await db.superuser<{ n: number | null }>('select draft_number as n from public.community_websites where world_id = $1', [world]))[0]!.n

/** Starts the draft in the Studio from a blank website, writes `html` and saves. */
async function startAndSave(w: Window, html: string): Promise<void> {
  await click(w, 'Edit the draft')
  await click(w, 'Blank website')
  await until(() => expect(editor(w)).toBeTruthy())
  type(editor(w), html)
  await click(w, 'Save')
  await until(() => expect(w.container.querySelector('.ws-status')!.textContent).toBe('Saved'))
}

// Several windows, real database calls and Studio saves: more than Vitest's default 5 s on a busy machine.
describe('the Community Website window', { timeout: 30_000 }, () => {
  it('shows that nothing is published, lets a member start and save the draft, and shows it as not published', async () => {
    const { a, world } = await town()
    const ada = await open(a, world)
    await until(() => expect(text(ada)).toContain('Nothing has been published yet.'))
    expect(findButton(ada, 'Publish this version')).toBeUndefined()
    await startAndSave(ada, '<h1>Our town</h1>')
    expect(await draftNumber(world)).toBe(1)
    expect(text(ada)).toContain('Everyone in town can edit this draft.')
    await click(ada, 'Exit')
    await until(() => expect(text(ada)).toContain('Not published: version 1, saved by Ada'))
    expect(button(ada, 'Draft').getAttribute('aria-pressed')).toBe('true')
    // A member can look at the unpublished draft but is not offered to publish it.
    expect(findButton(ada, 'Publish this version')).toBeUndefined()
  })

  it('lets a moderator publish the version they look at, saying what changes, and shows it to everyone', async () => {
    const { owner, a, world } = await town()
    const ada = await open(a, world)
    await startAndSave(ada, '<h1>Hello</h1>')
    await click(ada, 'Exit')
    // Ada looks at the published version (nothing yet) while the moderator publishes.
    await click(ada, 'Published')
    await until(() => expect(text(ada)).toContain('Nothing has been published yet.'))
    const boss = await open(owner, world)
    await click(boss, 'Draft')
    await until(() => expect(findButton(boss, 'Publish this version')).toBeDefined())
    await click(boss, 'Publish this version')
    const dialog = boss.container.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain('Publish version 1?')
    expect(dialog.textContent).toContain('New pages: index.html')
    type(dialog.querySelector('input')!, 'First version')
    await click(boss, 'Publish')
    await until(() => expect(text(boss)).toContain('Version 1 is now what visitors see.'))
    expect(text(boss)).toContain('Published: version 1, saved by Ada')
    expect(await db.superuser("select action, reason from public.community_moderation_log where world_id = $1", [world])).toEqual([{ action: 'publish', reason: 'First version' }])
    // Ada gets it without doing anything: the announcement is a hint to reload.
    await until(() => expect(text(ada)).toContain('Published: version 1'))
  })

  it("tells a member when someone saved first, in the town's words, and who else is editing", async () => {
    const { a, b, world } = await town()
    const ada = await open(a, world)
    await startAndSave(ada, 'one')
    await click(ada, 'Exit')
    const bo = await open(b, world)
    // Both open the draft (version 1).
    await click(ada, 'Edit the draft')
    await click(bo, 'Edit the draft')
    await until(() => expect(text(ada)).toContain('Bo is editing the draft too.'))
    await until(() => expect(text(bo)).toContain('Ada is editing the draft too.'))
    type(editor(bo), 'Bo first')
    await click(bo, 'Save')
    await until(() => expect(text(ada)).toContain('Someone saved a newer draft (version 2).'))
    type(editor(ada), 'Ada second')
    await click(ada, 'Save')
    await until(() => expect(text(ada)).toContain('Someone else in town saved the draft after you opened it.'))
    await click(ada, 'Load the other version')
    await until(() => expect(editor(ada).value).toBe('Bo first'))
    expect(await draftNumber(world)).toBe(2)
    // Leaving the Studio clears "editing" for the others.
    await click(bo, 'Exit')
    await until(() => expect(text(ada)).not.toContain('Bo is editing'))
  })

  it('keeps members out of a locked draft, but not moderators', async () => {
    const { owner, a, world } = await town()
    await db.rpc(owner, 'set_hall_lock', { p_world: world, p_what: 'draft', p_locked: true })
    const ada = await open(a, world)
    await until(() => expect(text(ada)).toContain('A moderator has locked the draft for now.'))
    expect(button(ada, 'Edit the draft').disabled).toBe(true)
    const boss = await open(owner, world)
    await until(() => expect(text(boss)).toContain('only moderators can save it'))
    expect(button(boss, 'Edit the draft').disabled).toBe(false)
  })

  it('lists the versions, shows an older one, and lets a moderator roll back to it', async () => {
    const { owner, a, world } = await town()
    const ada = await open(a, world)
    await startAndSave(ada, 'v1')
    type(editor(ada), 'v2')
    await click(ada, 'Save')
    await until(() => expect(w(ada)).toBe('Saved'))
    await click(ada, 'Exit')
    await db.rpc(owner, 'publish_community_website', { p_world: world, p_number: 2 })
    const boss = await open(owner, world)
    await click(boss, 'Versions')
    await until(() => expect(boss.container.querySelectorAll('.cw-version')).toHaveLength(2))
    const first = [...boss.container.querySelectorAll<HTMLButtonElement>('.cw-version')].find(b => b.textContent!.startsWith('Version 1'))!
    act(() => first.click())
    await settle()
    await until(() => expect(text(boss)).toContain('Not published: version 1'))
    await click(boss, 'Publish this version')
    expect(boss.container.querySelector('[role="alertdialog"]')!.textContent).toContain('This goes back to version 1 (a rollback).')
    expect(boss.container.querySelector('[role="alertdialog"]')!.textContent).toContain('Changed pages: index.html')
    await click(boss, 'Publish')
    await until(() => expect(text(boss)).toContain('Published: version 1'))
    expect((await db.superuser<{ action: string }>("select action from public.community_moderation_log where world_id = $1 order by id", [world])).map(r => r.action)).toEqual(['publish', 'rollback'])
  })

  it('refuses a stranger plainly', async () => {
    const { world } = await town()
    const { me: stranger } = await player('Stranger')
    const s = await open(stranger, world)
    await until(() => expect(text(s)).toMatch(/not in that town/))
  })
})

const w = (win: Window): string | null | undefined => win.container.querySelector('.ws-status')?.textContent
