/**
 * Words the interface shows about where content is kept. They live here, away
 * from the storage code, so the website and Paint windows can show them
 * without importing anything that can write.
 *
 * Phase 3a keeps everything in this browser. Nothing here may suggest that
 * visitors on other devices can see it.
 */

/** Shown wherever saved content is listed (requirement FR-52). */
export const LOCAL_ONLY_LABEL = 'Saved on this device only'

/** Shown when browser storage could not be used and content is kept in memory. */
export const NOT_SAVED_NOTICE = 'Not saved: changes will be lost when you close this tab.'

/** What a visitor is told about the website they are looking at. */
export const VISITOR_LOCAL_NOTICE =
  "This website is stored on this device only. Visitors on other devices can't see it."

/** A visitor's version of the above when storage is unavailable. */
export const VISITOR_NOT_SAVED_NOTICE =
  'Browser storage is unavailable, so this website is shown from memory only.'

/** What the owner is told, in the editor, about where changes go. */
export const EDITOR_LOCAL_NOTICE =
  "Changes are saved in this browser on this device only. People on other devices or browsers can't see them."

/** Shown after the owner saves. Never says the website is published or shared. */
export const SAVED_LOCAL_NOTICE = 'Your changes were saved on this device only.'

/** Shown after a save when browser storage is unavailable and the change is only in memory. */
export const SAVED_MEMORY_NOTICE =
  'Your changes are kept only until you close this tab. Browser storage is unavailable, so nothing was saved to this device.'
