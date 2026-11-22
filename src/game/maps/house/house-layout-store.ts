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
    const problems = storedLayoutProblems(migrated)

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
    const wanted = checkLayoutForSave(layout)
    this.layouts.set(wanted.houseId, cloneLayout(wanted))
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

/**
 * Why a stored layout (already upgraded by `migrateLayout`) cannot be used. Empty when it can. Shared by every
 * store, so a layout from memory and one from the backend are judged by exactly the same rules.
 */
export function storedLayoutProblems(migrated: ReturnType<typeof migrateLayout>): string[] {
  const problems = [...migrated.problems]
  if (migrated.layout) {
    const template = getTemplate(migrated.layout.templateId)
    if (template) problems.push(...validateLayout(template, migrated.layout).map(x => x.message))
    else problems.push(`template "${migrated.layout.templateId}" is not in this build`)
  }
  return problems
}

/** The layout as it may be stored: upgraded and obeying every rule. Throws, with the reasons, otherwise. */
export function checkLayoutForSave(layout: HouseLayout): HouseLayout {
  if (layout.houseId.length === 0) throw new Error('A layout must belong to a house')
  const wanted = migrateLayout(layout)
  if (!wanted.layout) throw new Error(`Layout rejected: ${wanted.problems.join('; ')}`)
  const template = getTemplate(wanted.layout.templateId)
  if (!template) throw new Error(`Unknown interior template "${wanted.layout.templateId}"`)
  const violations = validateLayout(template, wanted.layout)
  if (violations.length > 0) throw new Error(`Layout rejected: ${violations.map(x => x.message).join('; ')}`)
  return wanted.layout
}

/** What the game needs from wherever layouts are kept. */
export interface HouseLayoutBacking extends HouseLayoutStore {
  loadWithRecovery(houseId: string): Promise<LoadedLayout>
}

/**
 * The store the game uses. It forwards to the store for the current session: memory without an account (Phase
 * 3a), the player's account with one (Phase 4, set by the app before the game starts). The game never knows which.
 */
export class HouseLayouts implements HouseLayoutBacking {
  private backing: HouseLayoutBacking = new InMemoryHouseLayoutStore()

  /** Switches stores. Called by the app when the player's identity changes; null goes back to memory. */
  use(backing: HouseLayoutBacking | null): void {
    this.backing = backing ?? new InMemoryHouseLayoutStore()
  }

  load(houseId: string): Promise<HouseLayout> {
    return this.backing.load(houseId)
  }

  loadWithRecovery(houseId: string): Promise<LoadedLayout> {
    return this.backing.loadWithRecovery(houseId)
  }

  save(layout: HouseLayout): Promise<void> {
    return this.backing.save(layout)
  }
}

/** The one store the game uses. */
export const houseLayouts = new HouseLayouts()
