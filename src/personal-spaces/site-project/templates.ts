import { createDefaultSite } from '../website/default-site'
import { normalizeHexColour } from '../website/contrast'
import { splitParagraphs } from '../website/site-text'
import type { FontId, PatternId, ReadonlySiteContent, SiteContent } from '../website/site-types'
import { validateExternalUrl } from '../website/url-policy'
import { cleanTitle } from './rules'
import { SITE_PROJECT_SCHEMA_VERSION, type ProjectOrigin, type SiteProject } from './types'

/**
 * Starting points for a website, and the conversion of old structured websites
 * into ordinary HTML and CSS files. Pure: the clock is passed in.
 *
 * Templates are only a start. After this, every page and every rule belongs to
 * the resident, who can keep, change or delete any of it.
 */

/** Escapes text for HTML, so resident text written in the old editor stays text. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function project(houseId: string, now: string, origin: ProjectOrigin, title: string, pages: SiteProject['pages'], css: string): SiteProject {
  return {
    schemaVersion: SITE_PROJECT_SCHEMA_VERSION,
    houseId,
    title: cleanTitle(title).slice(0, 60) || 'My website',
    homePage: pages[0]!.name,
    pages,
    css,
    assets: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
    origin,
  }
}

// ── Blank ───────────────────────────────────────────────────────────────

export const BLANK_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My website</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

</body>
</html>
`

/** One minimal, valid page and an empty stylesheet. No design imposed. */
export function blankProject(houseId: string, now: string): SiteProject {
  return project(houseId, now, { kind: 'blank' }, 'My website', [{ name: 'index.html', html: BLANK_INDEX }], '')
}

/** The starting text for a page the owner adds. */
export function newPageHtml(name: string): string {
  const title = escapeHtml(name.replace(/\.html$/, ''))
  return BLANK_INDEX.replace('<title>My website</title>', `<title>${title}</title>`)
}

// ── Converting a structured website ────────────────────────────────────────

const FONT_STACKS: Record<FontId, string> = {
  serif: 'Georgia, "Times New Roman", Times, serif',
  sans: 'Verdana, Geneva, Tahoma, sans-serif',
  mono: '"Courier New", Courier, monospace',
}

const PATTERNS: Record<PatternId, string> = {
  plain: '',
  dots: '  background-image: radial-gradient(rgba(255, 255, 255, 0.18) 1.5px, transparent 1.5px);\n  background-size: 14px 14px;\n',
  grid: '  background-image: linear-gradient(rgba(127, 127, 127, 0.18) 1px, transparent 1px),\n    linear-gradient(90deg, rgba(127, 127, 127, 0.18) 1px, transparent 1px);\n  background-size: 24px 24px;\n',
  stars: '  background-image: radial-gradient(#ffffff 1px, transparent 1.5px), radial-gradient(#ffffcc 1px, transparent 1.5px);\n  background-size: 53px 53px, 37px 37px;\n  background-position: 0 0, 19px 23px;\n',
}

const colour = (value: string, fallback: string): string => normalizeHexColour(value) ?? fallback

const NAV = [
  ['index.html', 'Home'],
  ['about.html', 'About'],
  ['projects.html', 'Projects'],
  ['links.html', 'Links'],
] as const

const paragraphs = (text: string): string =>
  splitParagraphs(text).map(p => `    <p>${escapeHtml(p).replace(/\n/g, '<br>\n      ')}</p>`).join('\n')

/** An external link if it passes the URL policy; otherwise the text alone (as before). */
function externalLink(url: string | null, text: string): string {
  if (url === null) return escapeHtml(text)
  const check = validateExternalUrl(url)
  return check.ok ? `<a href="${escapeHtml(check.href)}">${escapeHtml(text)}</a>` : `${escapeHtml(text)} <small>(link unavailable)</small>`
}

function pageShell(site: ReadonlySiteContent, pageTitle: string, current: string, main: string): string {
  const nav = NAV.map(([href, label]) =>
    href === current ? `      <li><strong>${label}</strong></li>` : `      <li><a href="${href}">${label}</a></li>`).join('\n')
  const tagline = site.profile.tagline ? `\n    <p class="tagline">${escapeHtml(site.profile.tagline)}</p>` : ''
  const construction = site.theme.underConstruction ? '\n  <p class="construction"><span>Under construction</span></p>' : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="banner">
    <h1>${escapeHtml(site.title)}</h1>${tagline}
    <p class="byline">A home page by ${escapeHtml(site.profile.displayName)}</p>
  </header>${construction}
  <div class="layout">
    <nav>
      <ul>
${nav}
      </ul>
    </nav>
    <main>
${main}
    </main>
  </div>
  <footer>Made in WebTown.</footer>
</body>
</html>
`
}

function stylesheet(site: ReadonlySiteContent): string {
  const t = site.theme
  const bg = colour(t.background, '#C0C0C0')
  const text = colour(t.text, '#000000')
  const link = colour(t.link, '#0000EE')
  const headerBg = colour(t.headerBackground, '#000080')
  const headerText = colour(t.headerText, '#FFFFFF')
  const font = FONT_STACKS[t.font] ?? FONT_STACKS.serif
  const pattern = PATTERNS[t.pattern] ?? ''
  return `/* style.css: applies to every page of the website. Change anything you like. */

body {
  margin: 0;
  background-color: ${bg};
${pattern}  color: ${text};
  font-family: ${font};
  font-size: 15px;
  line-height: 1.5;
}

a { color: ${link}; }

.banner {
  padding: 14px 18px;
  background: ${headerBg};
  color: ${headerText};
  border-bottom: 4px double ${headerText};
  text-align: center;
}
.banner h1 { margin: 0; font-size: 2.2em; }
.banner p { margin: 4px 0 0; }
.tagline { font-style: italic; }

.construction {
  margin: 0;
  padding: 3px 0;
  text-align: center;
  font: bold 13px Tahoma, Verdana, sans-serif;
  background: repeating-linear-gradient(45deg, #000 0 12px, #ffd700 12px 24px);
}
.construction span { padding: 1px 10px; color: #ffd700; background: #000; }

.layout {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 18px;
  padding: 16px 18px;
}
nav ul { margin: 0; padding: 0; list-style: none; }
nav li { margin: 0 0 6px; }

.box {
  margin: 0 0 16px;
  padding: 10px 14px;
  border: 3px ridge ${text};
}

footer {
  padding: 10px 18px 14px;
  border-top: 2px groove ${text};
  font-size: 0.8em;
  text-align: center;
}

@media (max-width: 640px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  nav ul { display: flex; flex-wrap: wrap; gap: 4px 16px; }
}
`
}

/**
 * The same website as a set of HTML and CSS files. Every old field is carried
 * over: title, name, tagline, home, about, projects (with links), links, the
 * theme's colours, font, pattern and the under-construction banner. All text is
 * escaped; only links the URL policy accepts stay links.
 */
export function siteContentToProject(site: ReadonlySiteContent | SiteContent, now: string, origin: ProjectOrigin): SiteProject {
  const name = site.profile.displayName
  const index = pageShell(site, site.title, 'index.html', `    <h2>Welcome!</h2>\n${paragraphs(site.home.welcome) || '    <p>Nothing here yet.</p>'}`)
  const about = pageShell(site, `About ${name}`, 'about.html', `    <h2>About ${escapeHtml(name)}</h2>\n${paragraphs(site.about.body) || '    <p>Nothing here yet.</p>'}`)
  const projects = pageShell(site, 'Projects', 'projects.html', ['    <h2>Projects</h2>',
    ...(site.projects.length === 0 ? ['    <p>No projects yet.</p>'] : site.projects.map(p =>
      `    <div class="box">\n      <h3>${escapeHtml(p.title)}</h3>\n${paragraphs(p.description).replace(/^ {4}/gm, '      ')}` +
      (p.url !== null ? `\n      <p>${externalLink(p.url, 'Visit this project')}</p>` : '') + '\n    </div>'))].join('\n'))
  const links = pageShell(site, 'Links', 'links.html', ['    <h2>Links</h2>',
    site.links.length === 0 ? '    <p>No links yet.</p>' : `    <ul>\n${site.links.map(l => `      <li>${externalLink(l.url, l.label)}</li>`).join('\n')}\n    </ul>`].join('\n'))

  return project(site.houseId, now, origin, site.title, [
    { name: 'index.html', html: index },
    { name: 'about.html', html: about },
    { name: 'projects.html', html: projects },
    { name: 'links.html', html: links },
  ], stylesheet(site))
}

/** A nostalgic, multi-page starter: the 90s-style homepage, as ordinary files. */
export function classicProject(houseId: string, now: string): SiteProject {
  return siteContentToProject(createDefaultSite(houseId, now), now, { kind: 'classic' })
}
