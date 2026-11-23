import Phaser from 'phaser'
import {
  DEPTH_PROMPT,
  PLAYER_BODY_H,
  PLAYER_BODY_OFFSET_X,
  PLAYER_BODY_OFFSET_Y,
  PLAYER_BODY_W,
  PLAYER_SPRITE_SCALE,
  depthForFeetY,
} from '../config/GameConfig'
import { animKey, avatarTexture, isAvatar, type AvatarId } from '../systems/avatars'
import type { RemoteView } from '../../lib/multiplayer-link'

/** From the feet (body bottom centre) to the sprite's centre, as for the local `Player` (48 x 64 frame). */
const FEET_TO_CENTRE_X = PLAYER_SPRITE_SCALE * (PLAYER_BODY_OFFSET_X + PLAYER_BODY_W / 2 - 24)
const FEET_TO_CENTRE_Y = PLAYER_SPRITE_SCALE * (PLAYER_BODY_OFFSET_Y + PLAYER_BODY_H - 32)
/** The name sits this far above the feet. */
const NAME_RISE = 40

/**
 * Another player: their sprite, walking or standing like the local player, with their name above. No physics
 * body: where they may walk was decided by their own game, and nobody bumps into them. Reused while they stay
 * in the scene; hidden, not destroyed, when they leave it.
 */
export class RemotePlayer {
  readonly sprite: Phaser.GameObjects.Sprite
  private readonly label: Phaser.GameObjects.Text
  private look: AvatarId = 'traveller'
  private bubble: Phaser.GameObjects.Text | null = null
  private bubbleTimer: Phaser.Time.TimerEvent | null = null
  feetX = 0
  feetY = 0

  constructor(private readonly scene: Phaser.Scene, view: RemoteView) {
    this.sprite = scene.add.sprite(0, 0, avatarTexture('traveller')).setScale(PLAYER_SPRITE_SCALE)
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#fff4d6',
        backgroundColor: '#2b1d14cc',
        padding: { x: 2, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_PROMPT - 1)
    this.apply(view)
  }

  get visible(): boolean {
    return this.sprite.visible
  }

  apply(view: RemoteView): void {
    const look = isAvatar(view.avatar) ? view.avatar : 'traveller'
    if (look !== this.look || !this.sprite.texture || this.sprite.texture.key === '__MISSING') {
      this.look = look
      const texture = this.scene.textures.exists(avatarTexture(look)) ? avatarTexture(look) : avatarTexture('traveller')
      this.sprite.setTexture(texture)
    }
    if (this.label.text !== view.name) this.label.setText(view.name)
    this.feetX = view.x
    this.feetY = view.y
    this.sprite.setPosition(view.x - FEET_TO_CENTRE_X, view.y - FEET_TO_CENTRE_Y)
    this.sprite.setDepth(depthForFeetY(view.y))
    this.label.setPosition(Math.round(view.x), Math.round(view.y - NAME_RISE))
    this.bubble?.setPosition(Math.round(view.x), Math.round(view.y - NAME_RISE - 10))

    const key = this.anim(view.walking ? 'walk' : 'idle', view.facing)
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key)
    this.setVisible(true)
  }

  setVisible(visible: boolean): void {
    if (this.sprite.visible === visible) return
    this.sprite.setVisible(visible)
    this.label.setVisible(visible)
    this.bubble?.setVisible(visible)
  }

  /** A short bubble above the name (an emote), replacing any earlier one. */
  say(text: string, ms = 2500): void {
    this.bubbleTimer?.remove()
    this.bubble?.destroy()
    this.bubble = this.scene.add
      .text(Math.round(this.feetX), Math.round(this.feetY - NAME_RISE - 10), text, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#2b1d14',
        backgroundColor: '#fff4d6',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_PROMPT)
    this.bubbleTimer = this.scene.time.delayedCall(ms, () => {
      this.bubble?.destroy()
      this.bubble = null
      this.bubbleTimer = null
    })
  }

  destroy(): void {
    this.bubbleTimer?.remove()
    this.bubble?.destroy()
    this.label.destroy()
    this.sprite.destroy()
  }

  private anim(kind: 'walk' | 'idle', dir: string): string {
    const key = animKey(kind, dir, this.look)
    return this.scene.anims.exists(key) ? key : animKey(kind, dir, 'traveller')
  }
}
