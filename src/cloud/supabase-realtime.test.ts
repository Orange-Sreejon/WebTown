import { describe, expect, it } from 'vitest'
import { supabaseRealtime, type RealtimeClientLike } from './supabase-backend'
import type { ChannelStatus } from '../multiplayer/transport'

/**
 * Stabilization B2: reopening a world's channel while the previous one is still being left. The fake client
 * behaves like realtime-js 2.119 (RealtimeClient.channel, RealtimeChannel._onClose, phoenix Channel.leave): the
 * same channel object is returned for a topic until it has closed, which needs the server's answer to the leave,
 * and a channel that is leaving ignores subscribe().
 */
type Callback = (status: string, error?: Error) => void

class FakeChannel {
  state: 'closed' | 'joined' | 'leaving' = 'closed'
  subscribeCalls = 0
  private callbacks: Callback[] = []
  constructor(readonly topic: string) {}
  on(): this { return this }
  presenceState(): Record<string, unknown[]> { return {} }
  track(): Promise<string> { return Promise.resolve('ok') }
  send(): Promise<string> { return Promise.resolve('ok') }
  subscribe(callback: Callback): this {
    this.subscribeCalls++
    if (this.state !== 'closed') return this // as realtime-js: only a closed channel joins
    this.callbacks.push(callback)
    this.state = 'joined'
    queueMicrotask(() => callback('SUBSCRIBED'))
    return this
  }
}

function fakeClient(): RealtimeClientLike & { channels: FakeChannel[]; answerLeave: () => void; created: number } {
  const pending: Array<() => void> = []
  const c = {
    channels: [] as FakeChannel[],
    created: 0,
    channel(topic: string) {
      const existing = c.channels.find(ch => ch.topic === `realtime:${topic}`)
      if (existing) return existing
      const ch = new FakeChannel(`realtime:${topic}`)
      c.created++
      c.channels.push(ch)
      return ch
    },
    getChannels() { return c.channels },
    removeChannel(ch: FakeChannel) {
      ch.state = 'leaving'
      return new Promise<'ok'>(resolve => {
        pending.push(() => {
          c.channels = c.channels.filter(x => x !== ch)
          ch.state = 'closed'
          resolve('ok')
        })
      })
    },
    answerLeave() { for (const p of pending.splice(0)) p() },
  }
  return c as unknown as RealtimeClientLike & { channels: FakeChannel[]; answerLeave: () => void; created: number }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

function openOn(transport: ReturnType<typeof supabaseRealtime>) {
  const statuses: ChannelStatus[] = []
  const channel = transport.open('world:w', 'key', ['mv'], {
    onStatus: s => statuses.push(s),
    onPresence: () => undefined,
    onBroadcast: () => undefined,
  })
  return { channel, statuses }
}

describe('the Supabase realtime adapter', () => {
  it('joins again when a channel for the same world is reopened before the old one has closed', async () => {
    const client = fakeClient()
    const transport = supabaseRealtime(client)
    const first = openOn(transport)
    await flush()
    expect(first.statuses).toEqual(['joined'])

    first.channel.leave()
    const second = openOn(transport) // at once: the server has not answered the leave yet
    await flush()
    expect(second.statuses).toEqual([]) // waiting, not stuck on the old object
    client.answerLeave()
    await flush()
    expect(second.statuses).toEqual(['joined'])
    expect(client.created).toBe(2)
    expect(first.statuses).toEqual(['joined']) // the old session hears nothing more
  })

  it('does not join at all if the new session is left again while it waits', async () => {
    const client = fakeClient()
    const transport = supabaseRealtime(client)
    const first = openOn(transport)
    await flush()
    first.channel.leave()
    const second = openOn(transport)
    second.channel.leave()
    client.answerLeave()
    await flush()
    expect(second.statuses).toEqual([])
    expect(client.created).toBe(1)
  })

  it('opens at once when nothing is being left', async () => {
    const client = fakeClient()
    const a = openOn(supabaseRealtime(client))
    await flush()
    expect(a.statuses).toEqual(['joined'])
  })
})
