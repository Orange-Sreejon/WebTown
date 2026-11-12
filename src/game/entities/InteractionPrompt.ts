import Phaser from 'phaser'
import { DEPTH_PROMPT } from '../config/GameConfig'

/**
 * The small "E — Enter House" label drawn next to a door.
 *
 * It lives in the world, not on the screen, so the camera carries it with the
 * door at any zoom. It sits above the time-of-day overlay so it stays readable
 * at night, and is hidden rather than destroyed between uses.
 */
export class InteractionPrompt {
  private readonly label: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene) {
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#fff4d6',
        backgroundColor: '#2b1d14',
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_PROMPT)
      .setVisible(false)
  }

  get isVisible(): boolean {
    return this.label.visible
  }

  /** Shows `text` with its bottom-centre at the given world position. */
  show(x: number, y: number, text: string): void {
    if (this.label.text !== text) this.label.setText(text)
    this.label.setPosition(Math.round(x), Math.round(y)).setVisible(true)
  }

  hide(): void {
    this.label.setVisible(false)
  }

  destroy(): void {
    this.label.destroy()
  }
}
