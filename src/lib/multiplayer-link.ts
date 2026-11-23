/**
 * Multiplayer as the game sees it (Phase 5): report where the local player is, and read where everyone else
 * is. Set by the app while a shared world session runs, null otherwise (single player, as before). Holds no
 * network code, so Phaser scenes can import it without depending on the transport.
 */

export type LinkFacing = 'up' | 'down' | 'left' | 'right'

/** The local player, as the scene reports it every frame. `scene` is `town` or `house:<slot>`. */
export interface LocalState {
  scene: string
  x: number
  y: number
  facing: LinkFacing
  walking: boolean
}

/** Another player, where the game should draw them now (feet position). */
export interface RemoteView {
  /** Stable per player (their user id). */
  id: string
  name: string
  avatar: string
  x: number
  y: number
  facing: LinkFacing
  walking: boolean
  /** Jump straight there (they changed scene, or were away): no tween from the old spot. */
  snap: boolean
}

export type EmoteName = 'wave' | 'heart' | 'laugh' | 'surprise'

/** Things the game shows when they happen. */
export type GameEvent =
  /** self: the local player's own emote. */
  | { kind: 'emote'; from: string; emote: EmoteName; self?: boolean }
  | { kind: 'notice'; text: string }

export interface MultiplayerLink {
  /** The local player's look, as chosen in their profile. */
  readonly selfAvatar: string
  /** Called every frame by the active scene; the session decides what to send and when. */
  publish(state: LocalState, now: number): void
  /** The other players in `scene`, interpolated for `now`. */
  remotes(scene: string, now: number): readonly RemoteView[]
  /** The nearest other player within greeting range of `at` in `scene`, or null. */
  nearestInRange(scene: string, at: { x: number; y: number }, now: number): { id: string; name: string } | null
  /** Shows an emote above the local player for everyone; a wave goes to `to` (a player id) and is range-checked. */
  emote(emote: EmoteName, to?: string): void
  /** Waves to the nearest player in range, or says nobody is close enough. */
  wave(): void
  /** Listens for emotes and notices; returns the unsubscribe. */
  onEvent(listener: (event: GameEvent) => void): () => void
}

let current: MultiplayerLink | null = null

export function setMultiplayerLink(link: MultiplayerLink | null): void {
  current = link
}

export function multiplayerLink(): MultiplayerLink | null {
  return current
}
