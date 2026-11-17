import { createDefaultSite } from '../../personal-spaces/website/default-site'
import { toReadonlySite } from '../../personal-spaces/website/site-readonly'
import type { ReadonlySiteContent, SiteContent } from '../../personal-spaces/website/site-types'

/** Test support: sites to render. Used only by tests. */

export const STAMP = '2026-11-16T12:00:00.000Z'

export const defaultSite = (houseId = 'house-a'): SiteContent => createDefaultSite(houseId, STAMP)

export const readonlySite = (houseId = 'house-a'): ReadonlySiteContent => toReadonlySite(defaultSite(houseId))

/** Text that would do harm if it were ever treated as markup or code. */
export const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror="window.__xss = 1">',
  '<a href="javascript:window.__xss = 1">click me</a>',
  '<iframe src="https://example.com"></iframe>',
  '<style>body { display: none }</style>',
  '<svg onload="window.__xss = 1"></svg>',
  '<b onmouseover="window.__xss = 1">hover</b>',
  '&lt;b&gt;already escaped&lt;/b&gt; &amp; &#60;i&#62;',
] as const

/** A site with `payload` in every field that holds text. Its two valid links stay valid. */
export function hostileSite(payload: string): SiteContent {
  const site = defaultSite()
  site.title = payload
  site.profile.displayName = payload
  site.profile.tagline = payload
  site.home.welcome = `${payload}\n\n${payload}`
  site.about.body = `${payload}\n\n${payload}`
  for (const project of site.projects) {
    project.title = payload
    project.description = payload
  }
  for (const link of site.links) link.label = payload
  return site
}

/** The number of links in a site that point somewhere valid. */
export const validLinkCount = (site: SiteContent): number =>
  site.links.length + site.projects.filter(project => project.url !== null).length
