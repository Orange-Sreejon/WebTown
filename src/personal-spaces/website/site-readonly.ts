import type { ReadonlySiteContent, SiteContent } from './site-types'

/** An independent deep copy. Editing the copy never touches the original. */
export function cloneSite(site: SiteContent | ReadonlySiteContent): SiteContent {
  return {
    schemaVersion: site.schemaVersion,
    houseId: site.houseId,
    updatedAt: site.updatedAt,
    title: site.title,
    profile: { ...site.profile },
    home: { ...site.home },
    about: { ...site.about },
    projects: site.projects.map(project => ({ ...project })),
    links: site.links.map(link => ({ ...link })),
    theme: { ...site.theme },
  }
}

function freezeDeep<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null && !Object.isFrozen(child)) freezeDeep(child)
  }
  return Object.freeze(value)
}

/**
 * What a visitor is given: a deep copy that is read-only to the compiler (the
 * type) and at run time (frozen, so an attempt to assign throws in strict
 * code). It is a copy, so freezing it can never lock the owner's draft.
 *
 * Phase 3a: this protects against mistakes, not against someone using browser
 * developer tools. Real protection is server-side authorisation (Phase 3b).
 */
export function toReadonlySite(site: SiteContent | ReadonlySiteContent): ReadonlySiteContent {
  return freezeDeep(cloneSite(site))
}

/**
 * The next free id for a list entry: `project-1`, `project-2`, ... Never reuses
 * an id that is present, so a new entry can never take over another's.
 */
export function nextEntryId(existing: readonly { readonly id: string }[], prefix: string): string {
  const taken = new Set(existing.map(entry => entry.id))
  let n = 1
  while (taken.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}
