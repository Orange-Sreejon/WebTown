import { createDefaultLayout, getTemplate } from './default-interior'
import { cloneLayout, type HouseLayout } from './house-layout'
import { validateLayout } from './layout-rules'

/**
 * Where house layouts live.
 *
 * The interface is asynchronous on purpose: the in-memory implementation
 * answers immediately, but a backend implementation (a later phase) cannot.
 * Callers hold a COPY of a layout, never the stored object, so editing a
 * layout in hand changes nothing until it is saved, and saving house A can
 * never change house B.
 */
export interface HouseLayoutStore {
  /** The house's layout. A house nobody has edited gets a fresh copy of the default. */
  load(houseId: string): Promise<HouseLayout>
  /** Stores the layout for `layout.houseId`. Rejects a layout that breaks any rule. */
  save(layout: HouseLayout): Promise<void>
}

/**
 * Session-only storage: nothing survives a reload. Used until accounts and a
 * backend exist; there is deliberately no localStorage.
 */
export class InMemoryHouseLayoutStore implements HouseLayoutStore {
  private readonly layouts = new Map<string, HouseLayout>()

  constructor(private readonly makeDefault: (houseId: string) => HouseLayout = createDefaultLayout) {}

  async load(houseId: string): Promise<HouseLayout> {
    let stored = this.layouts.get(houseId)
    if (!stored) {
      stored = this.makeDefault(houseId)
      this.layouts.set(houseId, stored)
    }
    return cloneLayout(stored)
  }

  async save(layout: HouseLayout): Promise<void> {
    if (layout.houseId.length === 0) throw new Error('A layout must belong to a house')

    const template = getTemplate(layout.templateId)
    if (!template) throw new Error(`Unknown interior template "${layout.templateId}"`)

    const violations = validateLayout(template, layout)
    if (violations.length > 0) {
      throw new Error(`Layout rejected: ${violations.map(x => x.message).join('; ')}`)
    }

    this.layouts.set(layout.houseId, cloneLayout(layout))
  }
}

/** The one store the game uses for now. */
export const houseLayouts: HouseLayoutStore = new InMemoryHouseLayoutStore()
