import Phaser from 'phaser'
import { DEPTH_EDITOR_GRID, DEPTH_EDITOR_OVERLAY, TILE_SIZE } from '../config/GameConfig'
import { pieceBounds, type InteriorDefinition, type InteriorPiece } from '../maps/interior-layout'
import type { PreviewState } from '../maps/house/editor-session'
import { textureForSprite } from '../maps/interior-textures'
import { playerBodyRect } from '../systems/return-position'

const GRID_COLOR = 0xffffff
const GRID_ALPHA = 0.12
const KEEP_CLEAR_COLOR = 0x4fc3f7
const SELECT_COLOR = 0xffe066
const VALID_COLOR = 0x7dff8a
const INVALID_COLOR = 0xff6b6b
const GHOST_ALPHA = 0.85
const FOOTPRINT_ALPHA = 0.3

/**
 * What edit mode draws on top of the room: a 16px grid, the keep-clear zones
 * (the way to the door and the spot inside it), the selection outline, and the
 * green or red preview of whatever is being dragged or placed.
 *
 * Purely visual. It owns its game objects and destroys them with itself; the
 * editor's state lives in `EditorSession`.
 */
export class EditorOverlay {
  private readonly grid: Phaser.GameObjects.Graphics
  private readonly marks: Phaser.GameObjects.Graphics
  private ghosts: Phaser.GameObjects.Image[] = []

  constructor(private readonly scene: Phaser.Scene, def: InteriorDefinition) {
    this.grid = scene.add.graphics().setDepth(DEPTH_EDITOR_GRID).setVisible(false)
    this.marks = scene.add.graphics().setDepth(DEPTH_EDITOR_OVERLAY).setVisible(false)
    this.drawGrid(def)
  }

  setVisible(visible: boolean): void {
    this.grid.setVisible(visible)
    this.marks.setVisible(visible)
    if (!visible) this.clearMarks()
  }

  /** Redraws the selection and the preview. */
  render(selected: InteriorPiece | null, preview: PreviewState | null): void {
    this.clearMarks()

    if (preview) {
      const color = preview.valid ? VALID_COLOR : INVALID_COLOR
      preview.pieces.forEach((piece, i) => {
        const { key, frame } = textureForSprite(piece.sprite)
        const bounds = pieceBounds(piece)
        const ghost = this.scene.add
          .image(bounds.x, bounds.y + bounds.h, key, frame)
          .setOrigin(0, 1)
          .setTint(color)
          .setAlpha(GHOST_ALPHA)
          .setDepth(DEPTH_EDITOR_OVERLAY + 1 + i * 0.01)
        this.ghosts.push(ghost)

        if (piece.solid) {
          const s = piece.solid
          this.marks.fillStyle(color, FOOTPRINT_ALPHA).fillRect(s.x, s.y, s.w, s.h)
          this.marks.lineStyle(1, color, 1).strokeRect(s.x, s.y, s.w, s.h)
        } else {
          this.marks.lineStyle(1, color, 1).strokeRect(bounds.x, bounds.y, bounds.w, bounds.h)
        }
      })
      return
    }

    if (selected) {
      const b = pieceBounds(selected)
      this.marks.lineStyle(1, SELECT_COLOR, 1).strokeRect(b.x - 0.5, b.y - 0.5, b.w + 1, b.h + 1)
      if (selected.solid) {
        const s = selected.solid
        this.marks.lineStyle(1, SELECT_COLOR, 0.6).strokeRect(s.x, s.y, s.w, s.h)
      }
    }
  }

  destroy(): void {
    this.clearMarks()
    this.grid.destroy()
    this.marks.destroy()
  }

  private clearMarks(): void {
    this.marks.clear()
    for (const ghost of this.ghosts) ghost.destroy()
    this.ghosts = []
  }

  private drawGrid(def: InteriorDefinition): void {
    const g = this.grid
    g.lineStyle(1, GRID_COLOR, GRID_ALPHA)
    for (let x = 0; x <= def.widthPx; x += TILE_SIZE) g.lineBetween(x, 0, x, def.heightPx)
    for (let y = 0; y <= def.heightPx; y += TILE_SIZE) g.lineBetween(0, y, def.widthPx, y)

    // Keep clear: the way to the door, and the spot the player arrives on.
    const zone = def.exit.zone
    const spawn = playerBodyRect(def.spawn.feetX, def.spawn.feetY)
    g.fillStyle(KEEP_CLEAR_COLOR, 0.18).fillRect(zone.x, zone.y, zone.w, zone.h)
    g.lineStyle(1, KEEP_CLEAR_COLOR, 0.7).strokeRect(zone.x, zone.y, zone.w, zone.h)
    g.fillStyle(KEEP_CLEAR_COLOR, 0.18).fillRect(spawn.x, spawn.y, spawn.w, spawn.h)
    g.lineStyle(1, KEEP_CLEAR_COLOR, 0.7).strokeRect(spawn.x, spawn.y, spawn.w, spawn.h)
  }
}
