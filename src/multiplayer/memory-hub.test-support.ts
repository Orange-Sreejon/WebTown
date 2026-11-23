import type { ChannelHandlers, ChannelStatus, RealtimeChannel, RealtimeTransport } from './transport'

/**
 * Test support: a realtime service in memory, with the behaviour of Supabase Realtime that the session relies
 * on: private topics with an access rule, presence per key (dropped when a connection drops), broadcast to the
 * other subscribers only, connections that can be cut and restored, and messages held back to simulate delay.
 */
interface Sub {
  id: number
  client: HubClient
  topic: string
  key: string
  events: readonly string[]
  handlers: ChannelHandlers
  meta: Record<string, unknown> | null
  joined: boolean
}

export class MemoryHub {
  private subs = new Set<Sub>()
  private seq = 0
  /** Who may use a topic (the RLS policy). */
  allow: (userId: string, topic: string) => boolean = () => true
  /** How many presence changes each topic had (track, join, leave). */
  readonly presenceUpdates = new Map<string, number>()
  /** Every broadcast that went out, for assertions. */
  readonly sent: Array<{ from: string; topic: string; event: string; payload: unknown }> = []

  client(userId: string): HubClient {
    return new HubClient(this, userId)
  }

  /** @internal */
  add(sub: Omit<Sub, 'id' | 'joined' | 'meta'>): Sub {
    const s: Sub = { ...sub, id: ++this.seq, joined: false, meta: null }
    this.subs.add(s)
    return s
  }

  /** @internal */
  join(s: Sub): void {
    if (!this.subs.has(s) || !s.client.online) return
    if (!this.allow(s.client.userId, s.topic)) {
      s.handlers.onStatus('error', { fatal: true, message: 'Unauthorized: You do not have permissions to read from this Channel topic' })
      return
    }
    s.joined = true
    s.handlers.onStatus('joined')
    this.presenceChanged(s.topic)
  }

  /** @internal */
  remove(s: Sub): void {
    this.subs.delete(s)
    if (s.joined) this.presenceChanged(s.topic)
  }

  /** @internal */
  track(s: Sub, meta: Record<string, unknown>): void {
    s.meta = meta
    if (s.joined) this.presenceChanged(s.topic)
  }

  /** @internal */
  broadcast(from: Sub, event: string, payload: Record<string, unknown>): void {
    if (!from.joined) return
    this.sent.push({ from: from.client.userId, topic: from.topic, event, payload })
    for (const s of this.subs) {
      if (s === from || !s.joined || s.topic !== from.topic || !s.events.includes(event)) continue
      const deliver = (): void => { if (s.joined) s.handlers.onBroadcast(event, structuredClone(payload)) }
      s.client.deliver(deliver)
    }
  }

  /** Sends `payload` as if `userId` had broadcast it on `topic` (a misbehaving client). */
  inject(topic: string, event: string, payload: unknown): void {
    for (const s of this.subs) if (s.joined && s.topic === topic && s.events.includes(event)) s.handlers.onBroadcast(event, payload)
  }

  /** Publishes a presence entry for `key` on `topic` as a misbehaving client would. */
  fakePresence(topic: string, key: string, meta: Record<string, unknown>): void {
    const ghost: Sub = { id: ++this.seq, client: new HubClient(this, 'ghost'), topic, key, events: [], handlers: { onStatus() {}, onPresence() {}, onBroadcast() {} }, meta, joined: true }
    this.subs.add(ghost)
    this.presenceChanged(topic)
  }

  /** @internal */
  presenceChanged(topic: string): void {
    this.presenceUpdates.set(topic, (this.presenceUpdates.get(topic) ?? 0) + 1)
    const state = new Map<string, unknown[]>()
    for (const s of this.subs) {
      if (!s.joined || s.topic !== topic || !s.meta) continue
      const list = state.get(s.key) ?? []
      list.push(structuredClone(s.meta))
      state.set(s.key, list)
    }
    for (const s of this.subs) if (s.joined && s.topic === topic) s.client.deliver(() => { if (s.joined) s.handlers.onPresence(state) })
  }

  /** @internal Drops a client's connections (presence leaves for everyone else) and tells it. */
  disconnect(client: HubClient, status: ChannelStatus): void {
    const topics = new Set<string>()
    for (const s of this.subs) {
      if (s.client !== client || !s.joined) continue
      s.joined = false
      topics.add(s.topic)
      s.handlers.onStatus(status)
    }
    for (const t of topics) this.presenceChanged(t)
  }

  /** @internal */
  reconnect(client: HubClient): void {
    for (const s of this.subs) if (s.client === client && !s.joined) this.join(s)
  }

  subscribers(topic: string): number {
    return [...this.subs].filter(s => s.topic === topic && s.joined && s.client.userId !== 'ghost').length
  }
}

/** One browser: its connection to the hub. */
export class HubClient implements RealtimeTransport {
  online = true
  /** When set, incoming messages wait in `held` until `release()`. */
  hold = false
  private held: Array<() => void> = []

  constructor(private readonly hub: MemoryHub, readonly userId: string) {}

  open(topic: string, presenceKey: string, events: readonly string[], handlers: ChannelHandlers): RealtimeChannel {
    const hub = this.hub
    const sub = hub.add({ client: this, topic, key: presenceKey, events, handlers })
    let left = false
    queueMicrotask(() => { if (!left) hub.join(sub) })
    return {
      track: meta => { if (!left) hub.track(sub, structuredClone(meta)) },
      send: (event, payload) => { if (!left) hub.broadcast(sub, event, payload) },
      leave: () => {
        left = true
        hub.remove(sub)
      },
    }
  }

  /** @internal */
  deliver(run: () => void): void {
    if (this.hold) this.held.push(run)
    else run()
  }

  release(): void {
    const all = this.held
    this.held = []
    for (const run of all) run()
  }

  /** Network gone: everyone else sees this player leave; this client is told the channel closed. */
  goOffline(): void {
    this.online = false
    this.hub.disconnect(this, 'closed')
  }

  goOnline(): void {
    this.online = true
    this.hub.reconnect(this)
  }
}
