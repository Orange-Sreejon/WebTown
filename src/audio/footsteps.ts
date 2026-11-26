import { TILE_SIZE } from '../game/config/GameConfig'
import { TERRAIN } from '../game/maps/town-layout'
import { TILE_PATH, kindAt } from '../game/maps/terrain'
import type { SoundName } from './audio-engine'
import type { Surface } from './synth'

/**
 * Footsteps follow the walk animation (decision A3): each walk cycle is frames f0, f1, f2, f1 (Phaser numbers them
 * 1..4); a foot lands on the 1st and the 3rd. Only `walk-*` animations step, so standing never makes a sound.
 */
export function isStepFrame(animKey: string, frameIndex: number): boolean {
  return animKey.startsWith('walk-') && (frameIndex === 1 || frameIndex === 3)
}

/** What is underfoot in the town: the road is packed and paved; everything else walkable is grass. */
export function townSurfaceAt(feet: { x: number; y: number }): Surface {
  const kind = kindAt(TERRAIN, Math.floor(feet.x / TILE_SIZE), Math.floor(feet.y / TILE_SIZE))
  return kind === TILE_PATH ? 'path' : 'grass'
}

export const stepSound = (surface: Surface): SoundName =>
  surface === 'path' ? 'step-path' : surface === 'wood' ? 'step-wood' : 'step-grass'
