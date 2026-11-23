/**
 * What the world session needs from a realtime service: one channel per world with presence and broadcast.
 * Supabase Realtime implements it (`src/cloud/supabase-backend.ts`); tests use an in-memory hub. A
 * server-authoritative relay could implement it later without changes to the session or the game.
 */

/**
 * - `joined`: the channel is subscribed (again, after a reconnect).
 * - `error`: the channel failed; the transport keeps retrying unless `fatal` (the server refused it).
 * - `timed_out`, `closed`: lost for now; the transport keeps retrying.
 */
export type ChannelStatus = 'joined' | 'error' | 'timed_out' | 'closed'

export interface ChannelHandlers {
  onStatus(status: ChannelStatus, detail?: { fatal?: boolean; message?: string }): void
  /** The whole presence state after any change: key -> metas (one per connection with that key). */
  onPresence(state: ReadonlyMap<string, readonly unknown[]>): void
  onBroadcast(event: string, payload: unknown): void
}

export interface RealtimeChannel {
  /** Publishes this connection's presence. Kept across reconnects by the transport. */
  track(meta: Record<string, unknown>): void
  /** Best effort: dropped while not joined. */
  send(event: string, payload: Record<string, unknown>): void
  /** Leaves the channel; no handler is called afterwards. */
  leave(): void
}

export interface RealtimeTransport {
  /** Joins `topic` (private) with this connection's presence key. */
  open(topic: string, presenceKey: string, events: readonly string[], handlers: ChannelHandlers): RealtimeChannel
}
