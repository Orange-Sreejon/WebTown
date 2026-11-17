import { useId, type Ref } from 'react'
import { formatUpdated } from '../../personal-spaces/website/site-format'
import { splitParagraphs } from '../../personal-spaces/website/site-text'
import {
  SITE_PAGES,
  type ReadonlySiteContent,
  type SectionId,
} from '../../personal-spaces/website/site-types'
import { ExternalLink } from './ExternalLink'
import { patternOf, themeStyle } from './site-theme'
import './website.css'

interface SiteRendererProps {
  site: ReadonlySiteContent
  /** The page to show. */
  section: SectionId
  /** Called with one of the four page ids when a navigation button is pressed. */
  onNavigate: (section: SectionId) => void
  /** Lets the window move keyboard focus to the page after navigating. */
  mainRef?: Ref<HTMLElement>
}

/** Text with blank-line paragraphs. Every string is a React text node: nothing here parses markup. */
function Paragraphs({ text, empty }: { text: string; empty: string }): React.ReactElement {
  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) return <p className="wt-empty">{empty}</p>
  return (
    <>
      {paragraphs.map((paragraph, i) => (
        <p key={i} className="wt-paragraph">{paragraph}</p>
      ))}
    </>
  )
}

/**
 * Draws one resident's website. Presentation only: it is given data and says
 * which page was asked for; it loads and saves nothing and has no way to
 * change the site. It knows nothing about Phaser, storage or ownership, so the
 * visitor's window and the owner's window show exactly the same page.
 *
 * All text from the site (titles, names, descriptions, link labels) is placed
 * in the page as React text. `<script>` in a title shows as the characters
 * `<script>`; it is never parsed, so it cannot run or add elements. Links to
 * other sites go through `ExternalLink`, which applies the HTTPS policy.
 * Moving between the site's own pages uses buttons, not anchors, so it cannot
 * change the address of the page the game is on.
 */
export function SiteRenderer({ site, section, onNavigate, mainRef }: SiteRendererProps): React.ReactElement {
  const headingId = useId()
  const { profile, theme } = site

  return (
    <div className="wt-site" data-pattern={patternOf(theme)} style={themeStyle(theme)}>
      <div className="wt-page">
        <header className="wt-banner">
          <h1 className="wt-title">{site.title}</h1>
          {profile.tagline !== '' && <p className="wt-tagline">{profile.tagline}</p>}
          <p className="wt-byline">A home page by {profile.displayName}</p>
        </header>

        {theme.underConstruction && (
          <p className="wt-construction" role="note">
            <span>Under construction</span>
          </p>
        )}

        <div className="wt-layout">
          <nav className="wt-nav" aria-label="Website pages">
            <ul>
              {SITE_PAGES.map(page => (
                <li key={page.id}>
                  <button
                    type="button"
                    className="wt-nav-button"
                    aria-current={page.id === section ? 'page' : undefined}
                    onClick={() => onNavigate(page.id)}
                  >
                    {page.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <main className="wt-main" tabIndex={-1} ref={mainRef} aria-labelledby={headingId}>
            {section === 'home' && (
              <section>
                <h2 id={headingId} className="wt-heading">Welcome!</h2>
                <Paragraphs text={site.home.welcome} empty="Nothing here yet." />
                <div className="wt-box">
                  <h3 className="wt-subheading">Take a look around</h3>
                  <ul className="wt-contents">
                    <li>
                      <button type="button" className="wt-text-button" onClick={() => onNavigate('about')}>
                        About me
                      </button>
                    </li>
                    <li>
                      <button type="button" className="wt-text-button" onClick={() => onNavigate('projects')}>
                        Projects ({site.projects.length})
                      </button>
                    </li>
                    <li>
                      <button type="button" className="wt-text-button" onClick={() => onNavigate('links')}>
                        Links ({site.links.length})
                      </button>
                    </li>
                  </ul>
                </div>
              </section>
            )}

            {section === 'about' && (
              <section>
                <h2 id={headingId} className="wt-heading">{`About ${profile.displayName}`}</h2>
                <Paragraphs text={site.about.body} empty="Nothing here yet." />
              </section>
            )}

            {section === 'projects' && (
              <section>
                <h2 id={headingId} className="wt-heading">Projects</h2>
                {site.projects.length === 0 && <p className="wt-empty">No projects yet.</p>}
                {site.projects.map(project => (
                  <article key={project.id} className="wt-box">
                    <h3 className="wt-subheading">{project.title}</h3>
                    <Paragraphs text={project.description} empty="" />
                    {project.url !== null && (
                      <p className="wt-paragraph">
                        <ExternalLink url={project.url}>Visit this project</ExternalLink>
                      </p>
                    )}
                  </article>
                ))}
              </section>
            )}

            {section === 'links' && (
              <section>
                <h2 id={headingId} className="wt-heading">Links</h2>
                {site.links.length === 0 && <p className="wt-empty">No links yet.</p>}
                {site.links.length > 0 && (
                  <ul className="wt-links">
                    {site.links.map(link => (
                      <li key={link.id}>
                        <ExternalLink url={link.url}>{link.label}</ExternalLink>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </main>
        </div>

        <footer className="wt-footer">
          Last updated {formatUpdated(site.updatedAt)}. Made in WebTown.
        </footer>
      </div>
    </div>
  )
}
