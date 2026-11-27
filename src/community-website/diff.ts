import type { SiteProject } from '../personal-spaces/site-project/types'

/**
 * What publishing a version would change for visitors (CH-06): pages added, changed and removed, the stylesheet, the
 * name, the homepage and images, compared with what is published now. Pure. Shown to moderators before they publish.
 */
export interface SiteChanges {
  pagesAdded: string[]
  pagesChanged: string[]
  pagesRemoved: string[]
  cssChanged: boolean
  titleChanged: boolean
  homeChanged: boolean
  imagesAdded: string[]
  imagesRemoved: string[]
}

type Comparable = Pick<SiteProject, 'title' | 'homePage' | 'css' | 'pages' | 'assets'>

export function diffSites(published: Comparable | null, next: Comparable): SiteChanges {
  const before = new Map((published?.pages ?? []).map(p => [p.name, p.html]))
  const after = new Map(next.pages.map(p => [p.name, p.html]))
  const imagesBefore = new Map((published?.assets ?? []).map(a => [a.id, a.name]))
  const imagesAfter = new Map(next.assets.map(a => [a.id, a.name]))
  return {
    pagesAdded: next.pages.filter(p => !before.has(p.name)).map(p => p.name),
    pagesChanged: next.pages.filter(p => before.has(p.name) && before.get(p.name) !== p.html).map(p => p.name),
    pagesRemoved: (published?.pages ?? []).filter(p => !after.has(p.name)).map(p => p.name),
    cssChanged: (published?.css ?? '') !== next.css,
    titleChanged: published !== null && published.title !== next.title,
    homeChanged: published !== null && published.homePage !== next.homePage,
    imagesAdded: next.assets.filter(a => !imagesBefore.has(a.id)).map(a => a.name),
    imagesRemoved: (published?.assets ?? []).filter(a => !imagesAfter.has(a.id)).map(a => a.name),
  }
}

export const unchanged = (c: SiteChanges): boolean =>
  c.pagesAdded.length + c.pagesChanged.length + c.pagesRemoved.length + c.imagesAdded.length + c.imagesRemoved.length === 0 &&
  !c.cssChanged && !c.titleChanged && !c.homeChanged

/** The changes as short lines for people, for example "Changed pages: index.html, about.html". */
export function describeChanges(c: SiteChanges): string[] {
  const list = (names: string[]): string => (names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`)
  const lines: string[] = []
  if (c.titleChanged) lines.push('The website name changes.')
  if (c.homeChanged) lines.push('The homepage changes.')
  if (c.pagesAdded.length) lines.push(`New pages: ${list(c.pagesAdded)}`)
  if (c.pagesChanged.length) lines.push(`Changed pages: ${list(c.pagesChanged)}`)
  if (c.pagesRemoved.length) lines.push(`Removed pages: ${list(c.pagesRemoved)}`)
  if (c.cssChanged) lines.push('style.css changes.')
  if (c.imagesAdded.length) lines.push(`New images: ${list(c.imagesAdded)}`)
  if (c.imagesRemoved.length) lines.push(`Removed images: ${list(c.imagesRemoved)}`)
  return lines.length > 0 ? lines : ['Nothing changes: this is the same as the published version.']
}
