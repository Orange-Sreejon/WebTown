import Phaser from 'phaser'
import { AssetKeys } from '../config/AssetKeys'
import {
  DEPTH_GROUND,
  MAP_HEIGHT_PX,
  MAP_TILES_H,
  MAP_TILES_W,
  MAP_WIDTH_PX,
  TILE_SIZE,
} from '../config/GameConfig'
import {
  buildAnimals,
  buildCuteDecor,
  buildGardenTiles,
  buildYardPots,
  type FrameProp,
} from './cute-props'
import { addAnimalMotion, addChimneySmoke, createLampGlow, addWaterMotion } from './ambient'
import { buildGrassDecor, buildPathEdges, buildWaterProps, type DecorTile } from './decor'
import { kindAt, TILE_BANK, TILE_PATH, TILE_WATER } from './terrain'
import { FENCES, STRUCTURES, TERRAIN, TREES, VILLAGE_PROPS } from './town-layout'

/** Minimal shape of the FX controller we use, kept structural on purpose. */
interface ColorMatrixLike {
  saturate(value: number, multiply?: boolean): ColorMatrixLike
  contrast(value: number, multiply?: boolean): ColorMatrixLike
  brightness(value: number, multiply?: boolean): ColorMatrixLike
}

/**
 * Builds the town map using a single RenderTexture for every flat layer.
 *
 * WHY RenderTexture:
 *   Placing one Phaser Image per tile (80×64 = 5120 tiles) creates thousands of
 *   draw calls and freezes Phaser during create(). A RenderTexture stamps all
 *   tiles into one GPU texture in a single pass — ground, roads, shoreline and
 *   decoration become one draw call.
 *
 *   Only structures, fences, trees, props, animals and the player remain as
 *   individual sprites because they need to interact with the depth system or
 *   are animated.
 *
 * Every flat layer is derived from the terrain mask (see terrain.ts), so a
 * grass detail can never be stamped onto water or a path.
 */
export class TownMap {
  private scene: Phaser.Scene
  /** Street-lamp lights, dimmed or lit by the day-night cycle. */
  private lampLights: Phaser.GameObjects.Image[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  build(): void {
    const rt = this.scene.add.renderTexture(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX)
    rt.setOrigin(0, 0)
    rt.setDepth(DEPTH_GROUND)

    this.bakeTerrain(rt)
    this.stampDecor(rt, buildPathEdges(TERRAIN))
    this.stampDecor(rt, buildGrassDecor(TERRAIN))
    this.stampFrames(rt, buildGardenTiles())

    this.placeFences()
    this.placeStructures()
    this.placeTrees()
    this.placeProps(buildYardPots(TERRAIN))
    this.placeProps(buildCuteDecor(TERRAIN))
    this.placeVillageProps()
    this.placeWaterProps()
    this.placeAnimals()
  }

  // ── Ground, roads, shoreline and water baked in one pass ────────────────
  private bakeTerrain(rt: Phaser.GameObjects.RenderTexture): void {
    const T = TILE_SIZE

    for (let ty = 0; ty < MAP_TILES_H; ty++) {
      for (let tx = 0; tx < MAP_TILES_W; tx++) {
        const kind = kindAt(TERRAIN, tx, ty)

        let key: string = AssetKeys.GRASS_TILE
        if (kind === TILE_PATH || kind === TILE_BANK) key = AssetKeys.GROUND_TILE
        else if (kind === TILE_WATER) key = AssetKeys.WATER_TILE

        rt.stamp(key, 0, tx * T + T / 2, ty * T + T / 2)
      }
    }
  }

  private stampDecor(rt: Phaser.GameObjects.RenderTexture, decor: DecorTile[]): void {
    const T = TILE_SIZE
    for (const tile of decor) {
      rt.stamp(tile.key, 0, tile.tileX * T + T / 2, tile.tileY * T + T / 2)
    }
  }

  /** Flat 16×16 props from the outdoor decoration sheet (e.g. crop rows). */
  private stampFrames(rt: Phaser.GameObjects.RenderTexture, tiles: FrameProp[]): void {
    const T = TILE_SIZE
    for (const tile of tiles) {
      rt.stamp(tile.key, tile.frame, tile.tileX * T + T / 2, tile.tileY * T + T / 2)
    }
  }

  // ── Fences (yard frontages and the pasture) ─────────────────────────────
  private placeFences(): void {
    const T = TILE_SIZE

    for (const fence of FENCES) {
      if (fence.lenH > 0) {
        for (let i = 0; i < fence.lenH; i++) {
          this.scene.add
            .image((fence.x + i) * T + T / 2, fence.y * T + T / 2, fence.key)
            .setDepth(fence.depth)
        }
      } else {
        for (let i = 0; i < fence.lenV; i++) {
          this.scene.add
            .image(fence.x * T + T / 2, (fence.y + i) * T + T / 2, fence.key)
            .setRotation(Math.PI / 2)
            .setDepth(fence.depth)
        }
      }
    }
  }

  // ── Structures (houses, church, bridge) ─────────────────────────────────
  /**
   * How lit the street lamps are: 0 leaves them dark (daylight), 1 is the full
   * pool of light they throw at night. Driven by the evening/night part of the
   * day-night cycle, so they are still off in the morning and afternoon.
   */
  setLampLight(level: number): void {
    const alpha = 0.55 * level
    for (const light of this.lampLights) light.setAlpha(alpha)
  }

  private placeStructures(): void {
    const T = TILE_SIZE
    let smokeIndex = 0

    for (const structure of STRUCTURES) {
      const width = structure.wTiles * T
      const height = structure.hTiles * T
      const x = structure.tileX * T
      const y = structure.tileY * T

      const image = this.scene.add
        .image(x + width / 2, y + height / 2, structure.key)
        .setDepth(structure.depth)

      if (structure.key === AssetKeys.CUTE_HOUSE) this.harmonisePalette(image)

      // A faint wisp above every inhabited roof. The church has no chimney.
      if (structure.solid && structure.key !== AssetKeys.CHURCH) {
        addChimneySmoke(this.scene, x + width * 0.45, y + 18, smokeIndex++)
      }
    }
  }

  /**
   * The Cute Fantasy house is drawn with a darker, more saturated palette and
   * near-black outlines than the Pixeljad tileset. Easing off the colour,
   * compressing the tonality so the outlines lift to a soft dark brown, and
   * then nudging the whole sprite brighter puts it in the same light as its
   * neighbours.
   *
   * Phaser's colour matrix operations overwrite the matrix by default, hence
   * `multiply = true` on every step after the first.
   *
   * This is a WebGL effect, so on a Canvas fallback it is skipped and the
   * sprite simply renders untouched.
   */
  private harmonisePalette(
    image: Phaser.GameObjects.Image,
    saturate = -0.25,
    contrast = 0.82,
    brightness = 1.12,
  ): void {
    const fx = (
      image as unknown as { preFX?: { addColorMatrix(): ColorMatrixLike } | null }
    ).preFX

    fx?.addColorMatrix().saturate(saturate).contrast(contrast, true).brightness(brightness, true)
  }

  // ── Trees (three different species) ─────────────────────────────────────
  private placeTrees(): void {
    const T = TILE_SIZE

    for (const tree of TREES) {
      const x = tree.tileX * T + (tree.wTiles * T) / 2
      const y = tree.tileY * T + (tree.hTiles * T) / 2

      const image =
        tree.frame === undefined
          ? this.scene.add.image(x, y, tree.key)
          : this.scene.add.image(x, y, tree.key, tree.frame)

      image.setDepth(tree.depth)
    }
  }

  // ── Props and farm animals ───────────────────────────────────────────────
  private placeProps(props: FrameProp[]): void {
    const T = TILE_SIZE

    for (const item of props) {
      const x = item.tileX * T + (item.sizeTiles * T) / 2
      const y = item.tileY * T + (item.sizeTiles * T) / 2

      this.scene.add.image(x, y, item.key, item.frame).setDepth(item.depth)
    }
  }

  /**
   * Street furniture and the market square: lamp posts along the main roads,
   * benches, signposts, the well, hay bales and a row of market stalls.
   */
  private placeVillageProps(): void {
    const T = TILE_SIZE

    for (const prop of VILLAGE_PROPS) {
      // Anchored on the bottom edge of its tile and scaled to world size, so a
      // stall stands on the ground and grows upward like the houses do.
      const size = T * prop.scale

      // A soft shadow pools under every prop so it sits on the ground instead
      // of floating on it. Drawn just beneath the sprite, above the decor.
      this.scene.add
        .ellipse(
          prop.tileX * T + size / 2,
          prop.tileY * T + T - size * 0.06,
          size * 0.86,
          size * 0.26,
          0x000000,
          0.17,
        )
        .setDepth(prop.depth - 0.5)

      const centreX = prop.tileX * T + size / 2
      const baseY = prop.tileY * T + T

      // A warm, dark multiply: the pack ships much brighter than the Pixeljad
      // tileset it stands on, and tinting it down pulls it into the town's
      // light. A colour-matrix effect (as the Cute Fantasy houses use) is
      // deliberately not applied here — with a preFX pipeline active Phaser
      // bypasses the tint entirely, which is why the props stayed bright.
      const image = this.scene.add
        .image(centreX, baseY, prop.key)
        .setOrigin(0.5, 1)
        .setScale(prop.scale)
        .setDepth(prop.depth)

      // A lamp is a light source, so it keeps its full brightness and carries a
      // wide soft light instead of a tint. That light starts dark and is raised
      // by the day-night cycle — see setNightFactor.
      if (prop.key === AssetKeys.MARKET_LAMP) {
        this.lampLights.push(
          createLampGlow(this.scene, centreX, baseY - size * 0.45, size, prop.depth + 0.2),
        )
        continue
      }

      image.setTint(0xe8e1d4)
    }
  }

  /** Reeds and lily pads sit on the pond surface and bob very slightly. */
  private placeWaterProps(): void {
    const T = TILE_SIZE
    const props = buildWaterProps(TERRAIN)

    props.forEach((tile, index) => {
      const image = this.scene.add
        .image(tile.tileX * T + T / 2, tile.tileY * T + T / 2, tile.key)
        .setDepth(tile.depth)

      addWaterMotion(this.scene, image, index)
    })
  }

  private placeAnimals(): void {
    const T = TILE_SIZE

    buildAnimals().forEach((animal, index) => {
      const x = animal.tileX * T + (animal.sizeTiles * T) / 2
      const y = animal.tileY * T + (animal.sizeTiles * T) / 2

      const sprite = this.scene.add
        .image(x, y, animal.key, animal.frame)
        .setDepth(animal.depth)

      addAnimalMotion(this.scene, sprite, index)
    })
  }
}
