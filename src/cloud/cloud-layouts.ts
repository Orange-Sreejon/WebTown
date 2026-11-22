import { createDefaultLayout } from '../game/maps/house/default-interior'
import { cloneLayout, type HouseLayout } from '../game/maps/house/house-layout'
import {
  checkLayoutForSave,
  storedLayoutProblems,
  type HouseLayoutBacking,
  type LoadedLayout,
  type RecoveredLayout,
} from '../game/maps/house/house-layout-store'
import { migrateLayout } from '../game/maps/house/layout-migrations'
import { PermissionError } from '../personal-spaces/errors'
import { toAppError, type CloudBackend } from './backend'
import { houseIdForSlot, type PlayerContext } from './player'

const CONFLICT = "This house's furniture was changed somewhere else (another tab or device) since you came in. Leave the house and come back in to see it, then make your changes again."

/**
 * Furniture layouts in the player's account. The game talks to it through `houseLayouts` with map slots
 * (`house-a`); this maps them to the world's houses. Every save says which revision it started from, so a
 * stale save (another tab) is refused, never applied. Stored layouts are judged by the same rules as in memory;
 * one that cannot be used opens the standard room, and the stored one stays untouched until the owner saves.
 */
export class CloudLayoutStore implements HouseLayoutBacking {
  /** The revision each house's layout had when it was last read or written (0: none stored). */
  private readonly revisions = new Map<string, number>()
  private readonly kept: RecoveredLayout[] = []

  constructor(
    private readonly backend: CloudBackend,
    private readonly player: Pick<PlayerContext, 'houses'>,
    private readonly makeDefault: (houseId: string) => HouseLayout = createDefaultLayout,
  ) {}

  async load(slot: string): Promise<HouseLayout> {
    return (await this.loadWithRecovery(slot)).layout
  }

  async loadWithRecovery(slot: string): Promise<LoadedLayout> {
    const house = houseIdForSlot(this.player, slot)
    if (!house) return { layout: this.makeDefault(slot) }
    let raw: unknown
    try {
      raw = await this.backend.rpc('get_house_layout', { p_house: house })
    } catch (error) {
      throw toAppError(error)
    }
    if (raw === null || raw === undefined) {
      this.revisions.set(slot, 0)
      return { layout: this.makeDefault(slot) }
    }
    const r = raw as Record<string, unknown>
    this.revisions.set(slot, typeof r['revision'] === 'number' ? r['revision'] : 0)
    const stored = { houseId: slot, templateId: r['templateId'], schemaVersion: r['schemaVersion'], items: r['items'] }
    const migrated = migrateLayout(stored as unknown as HouseLayout)
    const problems = storedLayoutProblems(migrated)
    if (!migrated.layout || problems.length > 0) {
      const recovered: RecoveredLayout = { id: `${slot}#${this.kept.length + 1}`, houseId: slot, raw: stored, problems, recoveredAt: Date.now() }
      this.kept.push(recovered)
      console.warn(`[houseLayouts] the stored layout for "${slot}" cannot be used: ${problems.join('; ')}. It is left as it was.`)
      return { layout: this.makeDefault(slot), recovered: { ...recovered, problems: [...problems] } }
    }
    return { layout: cloneLayout(migrated.layout) }
  }

  async save(layout: HouseLayout): Promise<void> {
    const wanted = checkLayoutForSave(layout)
    const house = houseIdForSlot(this.player, wanted.houseId)
    if (!house) throw new PermissionError('This house is not in your world.')
    let result: { revision: number }
    try {
      result = await this.backend.rpc<{ revision: number }>('save_house_layout', {
        p_house: house,
        p_base_revision: this.revisions.get(wanted.houseId) ?? 0,
        p_template_id: wanted.templateId,
        p_schema_version: wanted.schemaVersion,
        p_items: cloneLayout(wanted).items,
      })
    } catch (error) {
      throw toAppError(error, CONFLICT)
    }
    this.revisions.set(wanted.houseId, result.revision)
  }

  /** Layouts that could not be used this session, as found. */
  recovered(): RecoveredLayout[] {
    return this.kept.map(k => ({ ...k, problems: [...k.problems] }))
  }
}
