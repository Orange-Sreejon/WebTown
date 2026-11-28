import { isUuid, newUuid } from '../cloud/backend'
import { parseLockAnnouncement } from '../cloud/community'
import { parseWebsiteAnnouncement } from '../cloud/community-website'
import type { RealtimeChannel, RealtimeTransport } from '../multiplayer/transport'

/**
 * The Community Website's live hints on the Hall channel (CH-06, design 4.3 and R3.4): who else is editing the draft
 * (presence `{ user, editing }`), and that someone saved the draft or a moderator published (the database's `website`
 * announcements). Hints only: anyone in the town can send them, so they are validated and only ever lead to showing
 * a name or reloading from the database. Nothing about the website itself travels here.
 */

export const WEBSITE_EVENT = 'website'

export type WebsiteHint = { kind: 'draft' | 'published'; number: number } | { kind: 'lock' }

export interface WebsiteChannelOptions {
  transport: RealtimeTransport
  worldId: string
  userId: string
  sessionId?: string
}

/** Who is editing, from the presence state: other users' ids whose meta says so. Malformed metas are ignored. */
export function editorsIn(state: ReadonlyMap<string, readonly unknown[]>, self: string): string[] {
  const out = new Set<string>()
  for (const metas of state.values()) {
    for (const m of metas) {
      if (!m || typeof m !== 'object') continue
      const { user, editing } = m as Record<string, unknown>
      if (editing === true && isUuid(user) && user !== self) out.add(user)
    }
  }
  return [...out].sort()
}

export class WebsiteChannel {
  private channel: RealtimeChannel | null = null
  private editing = false
  private editorIds: string[] = []
  private readonly hintListeners = new Set<(hint: WebsiteHint) => void>()
  private readonly editorListeners = new Set<(ids: string[]) => void>()

  constructor(private readonly options: WebsiteChannelOptions) {}

  start(): void {
    if (this.channel) return
    const { transport, worldId, userId } = this.options
    this.channel = transport.open(`hall:${worldId}`, this.options.sessionId ?? newUuid(), [WEBSITE_EVENT, 'lock'], {
      onStatus: () => undefined,
      onPresence: state => {
        const next = editorsIn(state, userId)
        if (next.join() === this.editorIds.join()) return
        this.editorIds = next
        for (const l of [...this.editorListeners]) l(next)
      },
      onBroadcast: (event, payload) => {
        // A lock of the draft (CH-07): only that something may have changed; the caller reads it again.
        const hint: WebsiteHint | null = event === WEBSITE_EVENT ? parseWebsiteAnnouncement(payload)
          : event === 'lock' && parseLockAnnouncement(payload)?.what === 'draft' ? { kind: 'lock' } : null
        if (hint) for (const l of [...this.hintListeners]) l(hint)
      },
    })
    this.channel.track({ user: userId, editing: this.editing })
  }

  /** Says whether this player has the draft open in the Studio. */
  setEditing(editing: boolean): void {
    if (editing === this.editing) return
    this.editing = editing
    this.channel?.track({ user: this.options.userId, editing })
  }

  /** Other members editing the draft now (user ids). */
  get editors(): readonly string[] {
    return this.editorIds
  }

  onHint(listener: (hint: WebsiteHint) => void): () => void {
    this.hintListeners.add(listener)
    return () => this.hintListeners.delete(listener)
  }

  onEditors(listener: (ids: string[]) => void): () => void {
    this.editorListeners.add(listener)
    return () => this.editorListeners.delete(listener)
  }

  stop(): void {
    this.channel?.leave()
    this.channel = null
    this.hintListeners.clear()
    this.editorListeners.clear()
  }
}
