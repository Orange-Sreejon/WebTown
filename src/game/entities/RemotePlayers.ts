import Phaser from 'phaser'
import { DEPTH_PROMPT } from '../config/GameConfig'
import { InteractionPrompt } from './InteractionPrompt'
import { RemotePlayer } from './RemotePlayer'
import { multiplayerLink, type EmoteName, type GameEvent, type LocalState, type MultiplayerLink } from '../../lib/multiplayer-link'
import type { Player } from './Player'

/** Hidden characters kept for reuse; beyond this many, the oldest hidden one is destroyed. */
const POOL_LIMIT = 8

/** What each emote shows above the head. */
export const EMOTE_TEXT: Record<EmoteName, string> = {
  wave: '👋 Hi!',
  heart: '❤',
  laugh: '😄',
  surprise: '❗',
}

/**
 * Everyone else in this scene (Phase 5). Each frame: report the local player to the multiplayer link, draw the
 * others where the link says they are, and offer "Q: Wave to <name>" when someone is close. Emotes show as
 * bubbles above whoever made them. Does nothing in single player (no link). Characters are kept by player id
 * and reused, so a packet never creates or destroys a sprite.
 */
export class RemotePlayers {
  private readonly byId = new Map<string, RemotePlayer>()
  private linked: MultiplayerLink | null = null
  private unsubscribe: (() => void) | null = null
  private prompt: InteractionPrompt | null = null
  private player: Player | undefined
  private localBubble: Phaser.GameObjects.Text | null = null
  private localBubbleTimer: Phaser.Time.TimerEvent | null = null
  private readonly onWaveKey = (event: KeyboardEvent): void => {
    if (!event.repeat) this.linked?.wave()
  }

  constructor(private readonly scene: Phaser.Scene, private readonly sceneId: string) {}

  /** The character drawn for a player, if they are in this scene. */
  get(id: string): RemotePlayer | undefined {
    const r = this.byId.get(id)
    return r?.visible ? r : undefined
  }

  update(player: Player | undefined, now: number): void {
    const link = multiplayerLink()
    if (link !== this.linked) this.bind(link)
    if (!link) return
    this.player = player

    let feet: { x: number; y: number } | null = null
    if (player?.body) {
      feet = player.feet
      const state: LocalState = { scene: this.sceneId, x: feet.x, y: feet.y, facing: player.facing, walking: player.walking }
      link.publish(state, now)
    }

    const seen = new Set<string>()
    for (const view of link.remotes(this.sceneId, now)) {
      seen.add(view.id)
      const existing = this.byId.get(view.id)
      if (existing) existing.apply(view)
      else this.byId.set(view.id, new RemotePlayer(this.scene, view))
    }
    let hidden = 0
    for (const [id, r] of this.byId) {
      if (seen.has(id)) continue
      r.setVisible(false)
      if (++hidden > POOL_LIMIT) {
        r.destroy()
        this.byId.delete(id)
      }
    }

    const target = feet ? link.nearestInRange(this.sceneId, feet, now) : null
    const drawnTarget = target ? this.get(target.id) : undefined
    if (target && drawnTarget) {
      this.prompt ??= new InteractionPrompt(this.scene)
      this.prompt.show(drawnTarget.feetX, drawnTarget.feetY + 12, `Q: Wave to ${target.name}`)
    } else {
      this.prompt?.hide()
    }
    if (this.localBubble && player) this.localBubble.setPosition(Math.round(player.feet.x), Math.round(player.feet.y - 40))
  }

  clear(): void {
    this.bind(null)
    for (const r of this.byId.values()) r.destroy()
    this.byId.clear()
    this.prompt?.destroy()
    this.prompt = null
    this.localBubbleTimer?.remove()
    this.localBubble?.destroy()
    this.localBubble = null
  }

  private bind(link: MultiplayerLink | null): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.scene.input.keyboard?.off('keydown-Q', this.onWaveKey)
    this.linked = link
    if (!link) {
      if (this.byId.size > 0) {
        for (const r of this.byId.values()) r.destroy()
        this.byId.clear()
      }
      this.prompt?.hide()
      return
    }
    this.unsubscribe = link.onEvent(event => this.onEvent(event))
    this.scene.input.keyboard?.on('keydown-Q', this.onWaveKey)
  }

  private onEvent(event: GameEvent): void {
    if (event.kind !== 'emote' || !this.scene.sys.isActive()) return
    const text = EMOTE_TEXT[event.emote]
    if (event.self) {
      if (this.player?.body) this.sayLocal(text)
      return
    }
    this.get(event.from)?.say(text)
  }

  private sayLocal(text: string): void {
    const player = this.player
    if (!player) return
    this.localBubbleTimer?.remove()
    this.localBubble?.destroy()
    this.localBubble = this.scene.add
      .text(Math.round(player.feet.x), Math.round(player.feet.y - 40), text, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#2b1d14',
        backgroundColor: '#fff4d6',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_PROMPT)
    this.localBubbleTimer = this.scene.time.delayedCall(2500, () => {
      this.localBubble?.destroy()
      this.localBubble = null
      this.localBubbleTimer = null
    })
  }
}
