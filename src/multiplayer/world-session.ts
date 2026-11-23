import {
  EVENT_EMOTE, EVENT_MOVE, isScene, parseEmote, parseMove, parsePresence,
  type Facing, type MoveMessage, type PresenceMeta, type SceneId,
} from './protocol'
import { addSample, easeDelay, poseAt, renderDelay, type Sample } from './interpolation'
import { Cooldown, TokenBucket } from './rate-limit'
import type { ChannelStatus, RealtimeChannel, RealtimeTransport } from './transport'
import type { EmoteName, GameEvent, LocalState, MultiplayerLink, RemoteView } from '../lib/multiplayer-link'

/**
 * One player's connection to their world's channel (design 3): connection state, who else is here (presence,
 * checked against the member list), and publishing where the local player is. Pure logic over a
 * `RealtimeTransport`; the game reads it through `MultiplayerLink`, the HUD through `subscribe`.
 */

export interface Member {
  userId: string
  displayName: string
  avatar: string
}

export type SessionStatus = 'connecting' | 'joined' | 'reconnecting' | 'lost' | 'failed' | 'stopped'

export type SessionEvent =
  | { kind: 'status'; status: SessionStatus }
  | { kind: 'joined'; userId: string; name: string }
  | { kind: 'left'; userId: string; name: string }
  | { kind: 'roster' }

export interface RosterEntry {
  userId: string
  name: string
  scene: SceneId
}

export interface WorldSessionOptions {
  transport: RealtimeTransport
  worldId: string
  userId: string
  /** This game's session id (a fresh UUID per mount). */
  sessionId: string
  /** The member list (database, RLS). Names and looks come only from here. */
  loadMembers: () => Promise<Member[]>
  selfAvatar: string
  now?: () => number
  /** Reconnecting for longer than this is "connection lost". */
  lostAfterMs?: number
}

/** Presence is re-published at most this often while the player moves. */
export const PRESENCE_INTERVAL_MS = 1000
/** Someone missing from presence for this long has left (a reconnect briefly empties presence). */
export const LEAVE_GRACE_MS = 1500
/** Unknown users in presence refresh the member list at most this often. */
export const MEMBER_REFRESH_MS = 5000
/** Movement is sent at most this often while walking (10 a second). */
export const MOVE_INTERVAL_MS = 100
/** The local walk speed (`PLAYER_SPEED`, px/s); a move implying more than 3 times this is refused. */
export const WALK_SPEED_PX_S = 80
const MAX_SPEED_PX_MS = (3 * WALK_SPEED_PX_S) / 1000
/** After this long without an accepted move, any position is accepted again (as a jump). */
export const RESYNC_MS = 2000
/** Incoming messages per sender: on average, and at once. */
export const SENDER_RATE = 20
export const SENDER_BURST = 30
/** A move from a session not (yet) in presence waits this long for its presence. */
const PENDING_MS = 2000
/** How close (feet to feet, px) two players must be to wave; the receiver allows some latency on top. */
export const GREET_RANGE_PX = 48
export const GREET_SLACK_PX = 32
/** One emote a second from this player; others' emotes at most every half second each. */
export const EMOTE_COOLDOWN_MS = 1000
const REMOTE_EMOTE_GAP_MS = 500

/** Presence positions are used only when moves have stopped arriving for this long (they are fresher). */
const PRESENCE_STALE_MS = RESYNC_MS

interface Remote {
  userId: string
  sessionId: string
  name: string
  avatar: string
  scene: SceneId
  x: number
  y: number
  facing: Facing
  walking: boolean
  /** The next frame should jump straight to the position. */
  snap: boolean
  /** Received positions, for interpolation. */
  samples: Sample[]
  /** The last accepted move's sequence number (-1: none from this session yet). */
  lastSeq: number
  /** When the last move was accepted (ms, this clock). */
  lastMoveAt: number
  /** The sender's clock of the last accepted move. */
  lastT: number
  /** Sender clock to this clock: the smallest (receive time - sender time) seen, i.e. the least delayed message. */
  offset: number
  /** How often their moves come while walking (ms, smoothed), which sets how far behind they are drawn. */
  interval: number
  /** How far behind they are drawn right now (eased towards enderDelay(interval)), and when last drawn. */
  delay: number
  drawnAt: number
  bucket: TokenBucket
  lastEmoteSeq: number
  emoteGap: Cooldown
}

export const fallbackName = (name: string | undefined): string => (name && name.trim() ? name.trim() : 'Player')

export class WorldSession implements MultiplayerLink {
  readonly selfAvatar: string
  private readonly o: Required<Omit<WorldSessionOptions, 'selfAvatar'>>
  private channel: RealtimeChannel | null = null
  private _status: SessionStatus = 'connecting'
  private readonly listeners = new Set<(e: SessionEvent) => void>()
  private readonly gameListeners = new Set<(e: GameEvent) => void>()
  private members = new Map<string, Member>()
  private membersLoadedAt = -Infinity
  private membersLoading: Promise<boolean> | null = null
  private readonly remotesByUser = new Map<string, Remote>()
  /** Users missing from presence, and since when. */
  private readonly missingSince = new Map<string, number>()
  private lastPresence: ReadonlyMap<string, readonly unknown[]> = new Map()
  private synced = false
  private local: LocalState | null = null
  private tracked: PresenceMeta | null = null
  private lastTrackAt = -Infinity
  private trackTimer: ReturnType<typeof setTimeout> | null = null
  private lostTimer: ReturnType<typeof setTimeout> | null = null
  private leaveTimer: ReturnType<typeof setTimeout> | null = null
  private readonly startedAt: number
  private seq = 0
  private lastMoveSentAt = -Infinity
  private lastSent: LocalState | null = null
  /** Moves from sessions whose presence has not arrived yet: the latest per session. */
  private readonly pending = new Map<string, { msg: MoveMessage; at: number }>()
  /** Incoming messages refused (malformed, stale, too fast, over the rate). For tests and debugging. */
  dropped = 0
  private readonly emoteCooldown = new Cooldown(EMOTE_COOLDOWN_MS)

  constructor(options: WorldSessionOptions) {
    this.o = {
      now: () => Date.now(),
      lostAfterMs: 60_000,
      ...options,
    }
    this.selfAvatar = options.selfAvatar
    this.startedAt = this.o.now()
  }

  get status(): SessionStatus {
    return this._status
  }

  get topic(): string {
    return `world:${this.o.worldId}`
  }

  subscribe(listener: (e: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onEvent(listener: (e: GameEvent) => void): () => void {
    this.gameListeners.add(listener)
    return () => this.gameListeners.delete(listener)
  }

  /** Who else is in the world right now (one entry per player). */
  roster(): RosterEntry[] {
    return [...this.remotesByUser.values()].map(r => ({ userId: r.userId, name: r.name, scene: r.scene }))
  }

  /** Loads the member list, then joins the channel. */
  async start(): Promise<void> {
    await this.refreshMembers(true)
    if (this._status === 'stopped') return
    this.open()
  }

  /** Leaves the channel and starts over (the Retry button). */
  retry(): void {
    if (this._status === 'stopped') return
    this.channel?.leave()
    this.channel = null
    this.setStatus('connecting')
    this.open()
  }

  stop(): void {
    if (this._status === 'stopped') return
    this.channel?.leave()
    this.channel = null
    for (const t of [this.trackTimer, this.lostTimer, this.leaveTimer]) if (t) clearTimeout(t)
    this.trackTimer = this.lostTimer = this.leaveTimer = null
    this.remotesByUser.clear()
    this.setStatus('stopped')
    this.listeners.clear()
    this.gameListeners.clear()
  }

  // ── Publishing ─────────────────────────────────────────────────────────────────────────────────────────

  publish(state: LocalState, now: number): void {
    if (!isScene(state.scene)) return
    const previous = this.local
    this.local = state
    const sceneChanged = previous !== null && previous.scene !== state.scene
    const stopped = previous !== null && previous.walking && !state.walking
    const moved = previous === null || previous.x !== state.x || previous.y !== state.y || previous.facing !== state.facing
    if (this.tracked === null || sceneChanged || stopped) {
      this.trackNow(now)
    } else if (moved) {
      this.scheduleTrack(now)
    }

    // Movement: 10 a second at most while walking, one when stopping, one on a scene change, nothing standing.
    const sent = this.lastSent
    const sceneMove = sent !== null && sent.scene !== state.scene
    const stopMove = sent !== null && sent.walking && !state.walking
    const changed = sent === null || sent.x !== state.x || sent.y !== state.y || sent.facing !== state.facing
    const due = now - this.lastMoveSentAt >= MOVE_INTERVAL_MS
    if (sceneMove || stopMove || (state.walking && changed && due)) this.sendMove(state, now)
  }

  private sendMove(state: LocalState, now: number): void {
    if (!this.channel || this._status !== 'joined' || !isScene(state.scene)) return
    const msg: MoveMessage = {
      v: 1, s: this.o.sessionId, q: ++this.seq, t: Math.max(0, Math.round(now - this.startedAt)), sc: state.scene,
      x: Math.round(state.x * 10) / 10, y: Math.round(state.y * 10) / 10, f: state.facing, w: state.walking ? 1 : 0,
    }
    this.channel.send(EVENT_MOVE, { ...msg })
    this.lastMoveSentAt = now
    this.lastSent = { ...state }
  }

  private presenceMeta(): PresenceMeta | null {
    const s = this.local
    if (!s || !isScene(s.scene)) return null
    return {
      v: 1, s: this.o.sessionId, u: this.o.userId, j: this.startedAt, q: this.seq, sc: s.scene,
      x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, f: s.facing,
    }
  }

  private trackNow(now: number): void {
    const meta = this.presenceMeta()
    if (!meta) return
    if (this.trackTimer) {
      clearTimeout(this.trackTimer)
      this.trackTimer = null
    }
    this.tracked = meta
    this.lastTrackAt = now
    if (this.channel && this._status === 'joined') this.channel.track({ ...meta })
  }

  private scheduleTrack(now: number): void {
    if (this.trackTimer) return
    const wait = Math.max(0, this.lastTrackAt + PRESENCE_INTERVAL_MS - now)
    this.trackTimer = setTimeout(() => {
      this.trackTimer = null
      this.trackNow(this.o.now())
    }, wait)
  }

  // ── Reading ────────────────────────────────────────────────────────────────────────────────────────────

  remotes(scene: string, now: number): readonly RemoteView[] {
    const out: RemoteView[] = []
    for (const r of this.remotesByUser.values()) {
      if (r.scene !== scene) continue
      if (r.drawnAt > -Infinity) r.delay = easeDelay(r.delay, renderDelay(r.interval), now - r.drawnAt)
      r.drawnAt = now
      const pose = poseAt(r.samples, now, r.delay)
      out.push({
        id: r.userId, name: r.name, avatar: r.avatar, snap: r.snap,
        x: pose?.x ?? r.x, y: pose?.y ?? r.y, facing: pose?.f ?? r.facing, walking: pose?.walking ?? false,
      })
      r.snap = false
    }
    return out
  }

  nearestInRange(scene: string, at: { x: number; y: number }, now: number): { id: string; name: string } | null {
    let best: { id: string; name: string } | null = null
    let bestDistance = Infinity
    for (const view of this.remotesNoSnap(scene, now)) {
      const d = Math.hypot(view.x - at.x, view.y - at.y)
      if (d <= GREET_RANGE_PX && d < bestDistance) {
        bestDistance = d
        best = { id: view.id, name: view.name }
      }
    }
    return best
  }

  wave(): void {
    const me = this.local
    if (!me) return
    const target = this.nearestInRange(me.scene, me, this.o.now())
    if (!target) {
      this.emitGame({ kind: 'notice', text: 'No one is close enough to wave to.' })
      return
    }
    this.emote('wave', target.id)
  }

  emote(emote: EmoteName, to?: string): void {
    const me = this.local
    const now = this.o.now()
    if (!me || !isScene(me.scene)) return
    let targetSession: string | undefined
    if (to !== undefined) {
      const target = this.remotesByUser.get(to)
      const pose = target && target.scene === me.scene ? this.remotesNoSnap(me.scene, now).find(v => v.id === to) : undefined
      if (!target || !pose || Math.hypot(pose.x - me.x, pose.y - me.y) > GREET_RANGE_PX) {
        this.emitGame({ kind: 'notice', text: target ? `${target.name} is too far away to wave to.` : 'They are not here any more.' })
        return
      }
      targetSession = target.sessionId
    }
    if (!this.emoteCooldown.take(now)) return
    if (this.channel && this._status === 'joined') {
      this.channel.send(EVENT_EMOTE, { v: 1, s: this.o.sessionId, q: ++this.seq, e: emote, ...(targetSession ? { to: targetSession } : {}) })
    }
    this.emitGame({ kind: 'emote', from: this.o.userId, emote, self: true })
  }

  /** The interpolated views of `scene` without consuming their snap flags. */
  private remotesNoSnap(scene: string, now: number): RemoteView[] {
    const out: RemoteView[] = []
    for (const r of this.remotesByUser.values()) {
      if (r.scene !== scene) continue
      const pose = poseAt(r.samples, now, r.delay)
      out.push({ id: r.userId, name: r.name, avatar: r.avatar, snap: false, x: pose?.x ?? r.x, y: pose?.y ?? r.y, facing: pose?.f ?? r.facing, walking: false })
    }
    return out
  }

  // ── Channel ────────────────────────────────────────────────────────────────────────────────────────────

  private open(): void {
    const channel = this.o.transport.open(this.topic, this.o.sessionId, [EVENT_MOVE, EVENT_EMOTE], {
      onStatus: (status, detail) => { if (this.channel === channel) this.onChannelStatus(status, detail) },
      onPresence: state => { if (this.channel === channel) this.onPresence(state) },
      onBroadcast: (event, payload) => { if (this.channel === channel) this.onBroadcast(event, payload) },
    })
    this.channel = channel
  }

  private onChannelStatus(status: ChannelStatus, detail?: { fatal?: boolean }): void {
    if (status === 'joined') {
      if (this.lostTimer) clearTimeout(this.lostTimer)
      this.lostTimer = null
      this.setStatus('joined')
      // Presence does not survive a rejoin; publish it again.
      const meta = this.presenceMeta()
      if (meta) {
        this.tracked = meta
        this.lastTrackAt = this.o.now()
        this.channel?.track({ ...meta })
      }
      return
    }
    if (detail?.fatal) {
      this.channel?.leave()
      this.channel = null
      this.remotesByUser.clear()
      this.emit({ kind: 'roster' })
      this.setStatus('failed')
      return
    }
    if (this._status === 'lost' || this._status === 'failed') return
    this.setStatus('reconnecting')
    if (!this.lostTimer) {
      this.lostTimer = setTimeout(() => {
        this.lostTimer = null
        if (this._status !== 'reconnecting') return
        this.remotesByUser.clear()
        this.emit({ kind: 'roster' })
        this.setStatus('lost')
      }, this.o.lostAfterMs)
    }
  }

  private onPresence(state: ReadonlyMap<string, readonly unknown[]>): void {
    this.lastPresence = state
    this.applyPresence()
  }

  /** Rebuilds the roster from the last presence state: one entry per member, the newest session of each. */
  private applyPresence(): void {
    const now = this.o.now()
    const newest = new Map<string, PresenceMeta>()
    let unknown = false
    for (const [key, metas] of this.lastPresence) {
      const meta = parsePresence(metas[metas.length - 1])
      if (!meta || meta.s !== key || meta.u === this.o.userId) continue
      if (!this.members.has(meta.u)) {
        unknown = true
        continue
      }
      const seen = newest.get(meta.u)
      if (!seen || meta.j > seen.j) newest.set(meta.u, meta)
    }
    if (unknown) void this.refreshMembers(false).then(loaded => { if (loaded) this.applyPresence() })

    let changed = false
    for (const [userId, meta] of newest) {
      this.missingSince.delete(userId)
      const member = this.members.get(userId)!
      const known = this.remotesByUser.get(userId)
      const sample: Sample = { t: now, x: meta.x, y: meta.y, f: meta.f, w: false }
      if (!known) {
        const r: Remote = {
          userId, sessionId: meta.s, name: fallbackName(member.displayName), avatar: member.avatar,
          scene: meta.sc, x: meta.x, y: meta.y, facing: meta.f, walking: false, snap: true,
          samples: [sample], lastSeq: -1, lastMoveAt: -Infinity, lastT: -1, offset: Infinity, interval: MOVE_INTERVAL_MS,
          delay: renderDelay(MOVE_INTERVAL_MS), drawnAt: -Infinity,
          bucket: new TokenBucket(SENDER_RATE, SENDER_BURST, now),
          lastEmoteSeq: -1, emoteGap: new Cooldown(REMOTE_EMOTE_GAP_MS),
        }
        this.remotesByUser.set(userId, r)
        changed = true
        if (this.synced) this.emit({ kind: 'joined', userId, name: fallbackName(member.displayName) })
        this.takePending(r, now)
      } else if (known.sessionId !== meta.s) {
        // A newer session of this player (another tab, or a reload): start over from its presence, and pick up a
        // name or look they may have changed meanwhile.
        void this.refreshMembers(false).then(loaded => { if (loaded) this.applyPresence() })
        Object.assign(known, {
          sessionId: meta.s, scene: meta.sc, x: meta.x, y: meta.y, facing: meta.f, walking: false, snap: true,
          samples: [sample], lastSeq: -1, lastMoveAt: -Infinity, lastT: -1, offset: Infinity, interval: MOVE_INTERVAL_MS, delay: renderDelay(MOVE_INTERVAL_MS), drawnAt: -Infinity, lastEmoteSeq: -1,
        })
        changed = true
        this.takePending(known, now)
      } else if (known.scene !== meta.sc) {
        Object.assign(known, { scene: meta.sc, x: meta.x, y: meta.y, facing: meta.f, walking: false, snap: true, samples: [sample] })
        changed = true
      } else if (meta.q >= known.lastSeq && now - known.lastMoveAt > PRESENCE_STALE_MS) {
        // Published after the last move received (moves were lost, or they are standing): the freshest news.
        if (addSample(known.samples, sample)) known.snap = true
        Object.assign(known, { x: meta.x, y: meta.y, facing: meta.f })
      }
    }
    for (const userId of this.remotesByUser.keys()) {
      if (!newest.has(userId) && !this.missingSince.has(userId)) this.missingSince.set(userId, now)
    }
    this.synced = true
    this.sweepLeavers(now)
    if (changed) this.emit({ kind: 'roster' })
  }

  // ── Movement in ────────────────────────────────────────────────────────────────────────────────────────

  private onBroadcast(event: string, payload: unknown): void {
    if (event !== EVENT_MOVE) return this.onOtherBroadcast(event, payload)
    const msg = parseMove(payload)
    if (!msg) {
      this.dropped++
      return
    }
    const now = this.o.now()
    const remote = this.remoteBySession(msg.s)
    if (!remote) {
      if (msg.s === this.o.sessionId) return
      // Presence usually arrives first; if not, keep the newest move for a moment.
      this.pending.set(msg.s, { msg, at: now })
      if (this.pending.size > 16) this.pending.delete(this.pending.keys().next().value!)
      return
    }
    this.applyMove(remote, msg, now)
  }

  /**
   * An emote: shown above the sender for everyone in their scene. A wave aimed at this player must come from
   * someone close by (their last reported position, with latency slack), or it is ignored.
   */
  private onOtherBroadcast(event: string, payload: unknown): void {
    if (event !== EVENT_EMOTE) return
    const msg = parseEmote(payload)
    const now = this.o.now()
    const r = msg ? this.remoteBySession(msg.s) : undefined
    if (!msg || !r || !r.bucket.take(now) || msg.q <= r.lastEmoteSeq || !r.emoteGap.take(now)) {
      this.dropped++
      return
    }
    const me = this.local
    if (msg.e === 'wave' && msg.to === this.o.sessionId) {
      const close = me !== null && me.scene === r.scene && Math.hypot(r.x - me.x, r.y - me.y) <= GREET_RANGE_PX + GREET_SLACK_PX
      if (!close) {
        // Refused: it does not move the sender's sequence on.
        this.dropped++
        return
      }
      r.lastEmoteSeq = msg.q
      this.emitGame({ kind: 'emote', from: r.userId, emote: msg.e })
      this.emitGame({ kind: 'notice', text: `${r.name} waved at you` })
      return
    }
    r.lastEmoteSeq = msg.q
    this.emitGame({ kind: 'emote', from: r.userId, emote: msg.e })
  }

  protected remoteBySession(sessionId: string): Remote | undefined {
    for (const r of this.remotesByUser.values()) if (r.sessionId === sessionId) return r
    return undefined
  }

  private takePending(remote: Remote, now: number): void {
    const p = this.pending.get(remote.sessionId)
    if (!p) return
    this.pending.delete(remote.sessionId)
    if (now - p.at <= PENDING_MS) this.applyMove(remote, p.msg, now)
  }

  /** Checks one move (rate, order, speed) and adds it to the player's samples. */
  private applyMove(r: Remote, msg: MoveMessage, now: number): void {
    if (!r.bucket.take(now)) {
      this.dropped++
      return
    }
    if (msg.q <= r.lastSeq || msg.t < r.lastT) {
      this.dropped++
      return
    }
    if (r.scene === msg.sc && r.lastMoveAt > -Infinity) {
      const since = now - r.lastMoveAt
      if (since < RESYNC_MS) {
        // Time between the two moves as the sender took them, but no more than they could have been apart.
        const elapsed = Math.min(msg.t - r.lastT, since + 1000)
        const allowed = MAX_SPEED_PX_MS * Math.max(elapsed, MOVE_INTERVAL_MS) + 16
        if (Math.hypot(msg.x - r.x, msg.y - r.y) > allowed) {
          this.dropped++
          return
        }
      }
    }
    if (r.lastT >= 0 && r.walking && msg.sc === r.scene) {
      // Up at once (a slower sender must not be outrun), down slowly.
      const gap = Math.min(msg.t - r.lastT, 1000)
      r.interval = Math.max(0.8 * r.interval + 0.2 * gap, gap)
    }
    r.lastSeq = msg.q
    r.lastMoveAt = now
    r.lastT = msg.t
    const offset = Math.min(r.offset, now - msg.t)
    if (Number.isFinite(r.offset) && offset < r.offset) {
      // A less delayed message: move the timeline earlier with it, so the samples stay in order.
      for (const s of r.samples) s.t -= r.offset - offset
    }
    r.offset = offset
    const sample: Sample = { t: msg.t + r.offset, x: msg.x, y: msg.y, f: msg.f, w: msg.w === 1 }
    const last = r.samples[r.samples.length - 1]
    if (r.scene === msg.sc && last && sample.t - last.t > 2 * MOVE_INTERVAL_MS) {
      // They were standing: start walking from there one interval before this move, at walking pace.
      r.samples.push({ ...last, t: sample.t - MOVE_INTERVAL_MS })
    }
    if (r.scene !== msg.sc) {
      r.scene = msg.sc
      r.samples = [sample]
      r.snap = true
      this.emit({ kind: 'roster' })
    } else if (addSample(r.samples, sample)) {
      r.snap = true
    }
    Object.assign(r, { x: msg.x, y: msg.y, facing: msg.f, walking: msg.w === 1 })
  }

  /** Removes players who have been missing from presence for the grace period. */
  private sweepLeavers(now: number): void {
    let changed = false
    for (const [userId, since] of this.missingSince) {
      if (now - since < LEAVE_GRACE_MS) continue
      this.missingSince.delete(userId)
      const gone = this.remotesByUser.get(userId)
      if (!gone) continue
      this.remotesByUser.delete(userId)
      changed = true
      this.emit({ kind: 'left', userId, name: gone.name })
    }
    if (changed) this.emit({ kind: 'roster' })
    if (this.missingSince.size > 0 && !this.leaveTimer && this._status !== 'stopped') {
      this.leaveTimer = setTimeout(() => {
        this.leaveTimer = null
        this.sweepLeavers(this.o.now())
      }, LEAVE_GRACE_MS)
    }
  }

  /** Reloads the member list, waiting out the rate limit if needed (one load at a time). True when loaded. */
  private async refreshMembers(force: boolean): Promise<boolean> {
    if (this.membersLoading) return this.membersLoading
    const wait = force ? 0 : Math.max(0, this.membersLoadedAt + MEMBER_REFRESH_MS - this.o.now())
    this.membersLoading = (wait > 0 ? new Promise<void>(r => setTimeout(r, wait)) : Promise.resolve()).then(() => {
      if (this._status === 'stopped') return false
      return this.loadMembersNow()
    }).finally(() => { this.membersLoading = null })
    return this.membersLoading
  }

  private async loadMembersNow(): Promise<boolean> {
    this.membersLoadedAt = this.o.now()
    return this.o.loadMembers().then(
      list => {
        this.members = new Map(list.map(m => [m.userId, m]))
        // Someone removed from the world disappears at once.
        let changed = false
        for (const [userId, r] of this.remotesByUser) {
          const m = this.members.get(userId)
          if (!m) {
            this.remotesByUser.delete(userId)
            changed = true
          } else {
            r.name = fallbackName(m.displayName)
            r.avatar = m.avatar
          }
        }
        if (changed) this.emit({ kind: 'roster' })
        return true
      },
      error => {
        console.warn('[multiplayer] could not load the member list', error)
        return false
      },
    )
  }

  private setStatus(status: SessionStatus): void {
    if (this._status === status) return
    this._status = status
    this.emit({ kind: 'status', status })
  }

  private emit(event: SessionEvent): void {
    for (const l of [...this.listeners]) l(event)
  }

  private emitGame(event: GameEvent): void {
    for (const l of [...this.gameListeners]) l(event)
  }
}
