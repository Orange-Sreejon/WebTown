import { createDefaultLayout, getTemplate } from './default-interior'
import { cloneLayout, type HouseLayout } from './house-layout'
import { migrateLayout } from './layout-migrations'
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
  /**
   * The house's layout, upgraded to the current schema version. A house nobody
   * has edited gets a fresh copy of the default. A stored layout that cannot be
   * read or breaks a rule is replaced by the default rather than thrown.
   */
  load(houseId: string): Promise<HouseLayout>
  /** Stores the layout for `layout.houseId`. Rejects a layout that breaks any rule. */
  save(layout: HouseLayout): Promise<void>
}

/**
 * A stored layout that could not be used, kept exactly as it was found.
 *
 * The copy is never thrown away silently: it is retrievable by `id` so the
 * owner's arrangement can be inspected or repaired later. It is not put back
 * into the house automatically, because a layout that failed the rules cannot
 * be saved again.
 */
export interface RecoveredLayout {
  /** Unique key for this copy. */
  id: string
  houseId: string
  /** Exactly what was stored: whatever version, whatever shape, whatever damage. */
  raw: unknown
  /** Why it could not be used. */
  problems: string[]
  /** When the fallback happened (epoch ms). */
  recoveredAt: number
}

export interface LoadedLayout {
  layout: HouseLayout
  /** Set when the stored layout could not be used and the standard room was returned instead. */
  recovered?: RecoveredLayout
}

/**
 * Session-only storage: nothing survives a reload. Used until accounts and a
 * backend exist; there is deliberately no localStorage.
 */
export class InMemoryHouseLayoutStore implements HouseLayoutStore {
  private readonly layouts = new Map<string, HouseLayout>()
  private readonly savedCopies = new Map<string, RecoveredLayout>()
  private recoveredCount = 0

  constructor(private readonly makeDefault: (houseId: string) => HouseLayout = createDefaultLayout) {}

  async load(houseId: string): Promise<HouseLayout> {
    return (await this.loadWithRecovery(houseId)).layout
  }

  /**
   * `load`, plus the copy of anything that had to be replaced.
   *
   * Stored layouts are upgraded on read (and the upgrade is written back, so it
   * happens once), then judged by the same rules the editor uses. Anything that
   * cannot be used — unreadable, from a newer build, or illegal — is set aside
   * and the standard room is returned, so a house is never unenterable.
   */
  async loadWithRecovery(houseId: string): Promise<LoadedLayout> {
    const stored = this.layouts.get(houseId)
    if (!stored) {
      const fresh = this.makeDefault(houseId)
      this.layouts.set(houseId, cloneLayout(fresh))
      return { layout: cloneLayout(fresh) }
    }

    const migrated = migrateLayout(stored)
    const problems = [...migrated.problems]
    if (migrated.layout) {
      const template = getTemplate(migrated.layout.templateId)
      if (template) problems.push(...validateLayout(template, migrated.layout).map(x => x.message))
      else problems.push(`template "${migrated.layout.templateId}" is not in this build`)
    }

    if (!migrated.layout || problems.length > 0) {
      const recovered = this.setAside(houseId, stored, problems)
      const fallback = this.makeDefault(houseId)
      this.layouts.set(houseId, cloneLayout(fallback))
      console.warn(
        `[houseLayouts] could not use the stored layout for "${houseId}": ${problems.join('; ')}. ` +
          `The standard room was opened; the original is kept as "${recovered.id}".`,
      )
      return { layout: cloneLayout(fallback), recovered }
    }

    // Persist the upgrade so later visits do not migrate again.
    if (migrated.applied.length > 0) this.layouts.set(houseId, cloneLayout(migrated.layout))
    return { layout: cloneLayout(migrated.layout) }
  }

  async save(layout: HouseLayout): Promise<void> {
    if (layout.houseId.length === 0) throw new Error('A layout must belong to a house')

    const wanted = migrateLayout(layout)
    if (!wanted.layout) throw new Error(`Layout rejected: ${wanted.problems.join('; ')}`)

    const template = getTemplate(wanted.layout.templateId)
    if (!template) throw new Error(`Unknown interior template "${wanted.layout.templateId}"`)

    const violations = validateLayout(template, wanted.layout)
    if (violations.length > 0) {
      throw new Error(`Layout rejected: ${violations.map(x => x.message).join('; ')}`)
    }

    this.layouts.set(wanted.layout.houseId, cloneLayout(wanted.layout))
  }

  /** Every copy set aside for a house, newest last. */
  recovered(houseId?: string): RecoveredLayout[] {
    const all = [...this.savedCopies.values()]
    const wanted = houseId === undefined ? all : all.filter(entry => entry.houseId === houseId)
    return wanted.map(entry => ({ ...entry, problems: [...entry.problems] }))
  }

  /** Forgets a copy, once the owner has taken what they need from it. */
  discardRecovered(id: string): boolean {
    return this.savedCopies.delete(id)
  }

  private setAside(houseId: string, stored: HouseLayout, problems: string[]): RecoveredLayout {
    const entry: RecoveredLayout = {
      id: `${houseId}#${++this.recoveredCount}`,
      houseId,
      raw: copyOf(stored),
      problems: [...problems],
      recoveredAt: Date.now(),
    }
    this.savedCopies.set(entry.id, entry)
    return { ...entry }
  }
}

/** A copy that survives the stored object being damaged or replaced further. */
function copyOf(value: unknown): unknown {
  if (value === undefined || value === null) return value
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

/** The one store the game uses for now. */
export const houseLayouts = new InMemoryHouseLayoutStore()
