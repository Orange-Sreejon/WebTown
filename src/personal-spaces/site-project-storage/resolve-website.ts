import { siteContentToProject } from '../site-project/templates'
import type { SiteSnapshot } from '../site-project/types'
import type { Clock, SiteLoadReport } from '../site-storage/site-record'
import type { ReadonlySiteContent } from '../website/site-types'
import type { SiteProjectReader } from './project-repository'

/** Reads the old structured websites (version 1), for migration only. */
export interface LegacySiteSource {
  loadWithReport(houseId: string): Promise<{ site: ReadonlySiteContent; report: SiteLoadReport }>
}

/** What a house's website is, whoever is looking. */
export type WebsiteState =
  /** A saved HTML/CSS website. `skipped` lists images that could not be loaded. */
  | { kind: 'project'; snapshot: SiteSnapshot; skipped: string[] }
  /**
   * The owner's old structured website, converted in memory to HTML and CSS
   * (revision 0). Nothing is written until the owner saves; the old record is
   * never changed.
   */
  | { kind: 'migrated'; snapshot: SiteSnapshot }
  /** A stored website that cannot be read. It is kept; the owner may start again over it. */
  | { kind: 'damaged'; problems: string[]; revision: number }
  /** Nothing saved yet. */
  | { kind: 'none' }

/**
 * The website for a house: the HTML/CSS project if there is one; otherwise
 * the old structured website, converted; otherwise nothing.
 *
 * An old record that is damaged is treated as nothing saved (the owner picks a
 * starting point) and is left untouched in storage.
 */
export async function resolveWebsite(
  houseId: string,
  sources: { projects: SiteProjectReader; legacy: LegacySiteSource; now: Clock },
): Promise<WebsiteState> {
  const load = await sources.projects.load(houseId)
  if (load.kind === 'saved') return { kind: 'project', snapshot: load.snapshot, skipped: load.skipped }
  if (load.kind === 'damaged') return { kind: 'damaged', problems: load.problems, revision: load.revision }

  const { site, report } = await sources.legacy.loadWithReport(houseId)
  if (report.origin !== 'saved') return { kind: 'none' }
  const project = siteContentToProject(site, sources.now(), { kind: 'migrated', sourceUpdatedAt: site.updatedAt })
  return { kind: 'migrated', snapshot: { project, assets: [] } }
}
