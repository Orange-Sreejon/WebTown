import { IdbDatabase } from './storage/idb'
import { STORE_META, WEBTOWN_DB } from './storage/webtown-db'

/**
 * The Studio's look on this device: light or dark. A preference of this browser, not of the website: it is kept
 * in WebTown's own IndexedDB (`meta`), never in the website's files, and never sent anywhere. When browser
 * storage is unavailable it lasts for this tab only.
 */
export type StudioThemePreference = 'light' | 'dark'

const KEY = 'studio-theme'
let remembered: StudioThemePreference | null = null
let db: IdbDatabase | null = null

const database = (): IdbDatabase => (db ??= new IdbDatabase(WEBTOWN_DB))

/** The saved choice, or null when the player never chose. */
export async function loadStudioTheme(): Promise<StudioThemePreference | null> {
  try {
    const raw = (await database().get(STORE_META, KEY)) as { value?: unknown } | undefined
    if (raw?.value === 'light' || raw?.value === 'dark') remembered = raw.value
  } catch {
    // No usable storage: keep whatever this tab chose.
  }
  return remembered
}

export async function saveStudioTheme(theme: StudioThemePreference): Promise<void> {
  remembered = theme
  try {
    await database().put(STORE_META, { key: KEY, value: theme })
  } catch {
    // Not saved beyond this tab; the Studio still switches.
  }
}

/** What was last loaded or chosen in this tab, without waiting. */
export const rememberedStudioTheme = (): StudioThemePreference | null => remembered

/** For tests: forget the tab's memory and the connection. */
export function resetStudioThemeMemory(): void {
  remembered = null
  db?.close()
  db = null
}
