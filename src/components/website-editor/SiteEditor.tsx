import { useEffect, useMemo, useRef, useState } from 'react'
import { EDITOR_LOCAL_NOTICE, NOT_SAVED_NOTICE } from '../../personal-spaces/labels'
import {
  addBlockedReason,
  addLink,
  addProject,
  applyPreset,
  contrastRows,
  moveLink,
  moveProject,
  previewOf,
  removeLink,
  removeProject,
  setLook,
  setUnderConstruction,
} from '../../personal-spaces/website/site-edit'
import {
  FONT_IDS,
  PATTERN_IDS,
  SITE_LIMITS,
  SITE_PAGES,
  THEME_PRESET_IDS,
  isSectionId,
  type FontId,
  type PatternId,
  type SectionId,
  type SiteContent,
  type ThemePresetId,
} from '../../personal-spaces/website/site-types'
import { validateSite } from '../../personal-spaces/website/site-validation'
import type { PresetId } from '../../personal-spaces/website/theme-presets'
import { SiteRenderer } from '../website/SiteRenderer'
import { CheckboxField, ColourField, SelectField, TextField, UrlField, fieldId } from './editor-fields'
import './website-editor.css'

const PRESET_LABELS: Record<ThemePresetId, string> = {
  'classic-grey': 'Classic grey',
  starfield: 'Starfield',
  pastel: 'Pastel',
  forest: 'Forest',
  custom: 'Custom colours',
}
const FONT_LABELS: Record<FontId, string> = {
  serif: 'Serif (Georgia)',
  sans: 'Sans-serif (Verdana)',
  mono: 'Typewriter (Courier)',
}
const PATTERN_LABELS: Record<PatternId, string> = {
  plain: 'Plain',
  dots: 'Dots',
  grid: 'Grid',
  stars: 'Stars',
}

interface SiteEditorProps {
  /** The working copy. The editor never changes it; it asks for a changed copy through `onChange`. */
  draft: SiteContent
  onChange: (next: SiteContent) => void
  /** The draft differs from what was loaded. */
  dirty: boolean
  saving: boolean
  /** Why the last save failed, in words; the draft is still here. */
  saveError: string | null
  /** Raised each time Save is pressed while the draft has problems. */
  attempt: number
  persistent: boolean
  onSave: () => void
  onCancel: () => void
}

/**
 * The owner's editor: a form for every field of the website, and beside it a
 * live preview made by the same `SiteRenderer` the visitor's page uses.
 *
 * It holds no storage and no writer. It is handed a draft and reports changes;
 * the window around it decides when to save. Nothing typed here reaches
 * IndexedDB until Save, and the preview is drawn from the draft in memory.
 *
 * Problems come from `validateSite`, the same check that guards the save, and
 * are shown beside the field they belong to (after the field is left, or after
 * Save is pressed) and gathered in a list when Save is pressed.
 */
export function SiteEditor({
  draft,
  onChange,
  dirty,
  saving,
  saveError,
  attempt,
  persistent,
  onSave,
  onCancel,
}: SiteEditorProps): React.ReactElement {
  const [pane, setPane] = useState<'form' | 'preview'>('form')
  const [previewSection, setPreviewSection] = useState<SectionId>('home')
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const headingRef = useRef<HTMLHeadingElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)

  const checked = useMemo(() => validateSite(draft), [draft])
  const errors = checked.ok ? [] : checked.errors
  const errorAt = (path: string): string | undefined => errors.find(e => e.path === path)?.message
  const attempted = attempt > 0

  // Show a problem next to its field once the field was visited, or after Save was pressed.
  const shown = (path: string): string | undefined => (attempted || touched.has(path) ? errorAt(path) : undefined)
  const touch = (path: string) => (): void => setTouched(prev => (prev.has(path) ? prev : new Set(prev).add(path)))

  const preview = useMemo(() => previewOf(draft), [draft])
  const rows = useMemo(() => contrastRows(draft.theme), [draft.theme])

  // On opening, put focus on the editor's heading so a keyboard or screen-reader user starts here.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // After Save is pressed with problems, move to the list of them.
  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus()
  }, [attempt])

  // After adding an entry, put the cursor in its first field.
  useEffect(() => {
    if (pendingFocus.current === null) return
    document.getElementById(pendingFocus.current)?.focus()
    pendingFocus.current = null
  })

  const showPreviewOf = (event: React.FocusEvent<HTMLElement>): void => {
    const section = (event.target as HTMLElement).closest('[data-preview]')?.getAttribute('data-preview')
    if (isSectionId(section)) setPreviewSection(section)
  }

  const goTo = (path: string): void => {
    document.getElementById(fieldId(path))?.focus()
  }

  const projectBlocked = addBlockedReason('project', draft.projects.length)
  const linkBlocked = addBlockedReason('link', draft.links.length)

  return (
    <div className="we-editor" data-pane={pane}>
      <div className="we-head">
        <h2 className="we-title" tabIndex={-1} ref={headingRef}>Edit your website</h2>
        <p className="we-local">{EDITOR_LOCAL_NOTICE}</p>
        <div className="we-panes" role="group" aria-label="What to show">
          <button type="button" className="we-button" aria-pressed={pane === 'form'} onClick={() => setPane('form')}>
            Edit
          </button>
          <button type="button" className="we-button" aria-pressed={pane === 'preview'} onClick={() => setPane('preview')}>
            Preview
          </button>
        </div>
      </div>

      <div className="we-body">
        <form
          id="we-form"
          className="we-form"
          aria-label="Website editor"
          noValidate
          onSubmit={event => {
            event.preventDefault()
            onSave()
          }}
          onFocusCapture={showPreviewOf}
        >
          {saveError !== null && (
            <div className="we-banner we-banner--problem" role="alert">
              <strong>Your changes were not saved.</strong> {saveError} Your draft is still here: fix the problem and
              press Save again.
            </div>
          )}

          {attempted && errors.length > 0 && (
            <div className="we-banner we-banner--problem we-summary" role="alert" tabIndex={-1} ref={summaryRef}>
              <strong>
                {errors.length === 1 ? '1 problem needs fixing' : `${errors.length} problems need fixing`} before this
                can be saved.
              </strong>
              <ul>
                {errors.map(error => (
                  <li key={`${error.path}:${error.message}`}>
                    <button type="button" className="we-link" onClick={() => goTo(error.path)}>
                      {error.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <fieldset className="we-group" data-preview="home">
            <legend>Your page</legend>
            <TextField
              path="title" label="Page title" value={draft.title} limit={SITE_LIMITS.title.max}
              error={shown('title')} onBlur={touch('title')}
              onChange={title => onChange({ ...draft, title })}
            />
            <TextField
              path="profile.displayName" label="Your name" value={draft.profile.displayName}
              limit={SITE_LIMITS.displayName.max} error={shown('profile.displayName')} onBlur={touch('profile.displayName')}
              onChange={displayName => onChange({ ...draft, profile: { ...draft.profile, displayName } })}
            />
            <TextField
              path="profile.tagline" label="Tagline (optional)" value={draft.profile.tagline}
              limit={SITE_LIMITS.tagline.max} error={shown('profile.tagline')} onBlur={touch('profile.tagline')}
              onChange={tagline => onChange({ ...draft, profile: { ...draft.profile, tagline } })}
            />
          </fieldset>

          <fieldset className="we-group" data-preview="home">
            <legend>Home page</legend>
            <TextField
              path="home.welcome" label="Welcome message" value={draft.home.welcome} multiline rows={6}
              limit={SITE_LIMITS.welcome.max} hint="Leave a blank line between paragraphs."
              error={shown('home.welcome')} onBlur={touch('home.welcome')}
              onChange={welcome => onChange({ ...draft, home: { welcome } })}
            />
          </fieldset>

          <fieldset className="we-group" data-preview="about">
            <legend>About page</legend>
            <TextField
              path="about.body" label="About you (optional)" value={draft.about.body} multiline rows={8}
              limit={SITE_LIMITS.aboutBody.max} hint="Leave a blank line between paragraphs."
              error={shown('about.body')} onBlur={touch('about.body')}
              onChange={body => onChange({ ...draft, about: { body } })}
            />
          </fieldset>

          <fieldset className="we-group" data-preview="projects">
            <legend>Projects</legend>
            {errorAt('projects') && attempted && <p className="we-error"><span className="we-error-label">Problem: </span>{errorAt('projects')}</p>}
            {draft.projects.length === 0 && <p className="we-hint">No projects yet.</p>}
            {draft.projects.map((project, index) => {
              const at = `projects[${index}]`
              const n = index + 1
              return (
                <fieldset key={project.id} className="we-entry">
                  <legend>Project {n}</legend>
                  <TextField
                    path={`${at}.title`} label={`Project ${n} title`} value={project.title}
                    limit={SITE_LIMITS.projectTitle.max} error={shown(`${at}.title`)} onBlur={touch(`${at}.title`)}
                    onChange={title => onChange({ ...draft, projects: draft.projects.map(p => (p.id === project.id ? { ...p, title } : p)) })}
                  />
                  <TextField
                    path={`${at}.description`} label={`Project ${n} description (optional)`} value={project.description}
                    multiline rows={3} limit={SITE_LIMITS.projectDescription.max}
                    error={shown(`${at}.description`)} onBlur={touch(`${at}.description`)}
                    onChange={description => onChange({ ...draft, projects: draft.projects.map(p => (p.id === project.id ? { ...p, description } : p)) })}
                  />
                  <UrlField
                    path={`${at}.url`} label={`Project ${n} link (optional)`} value={project.url ?? ''}
                    hint="A web address starting with https://" error={shown(`${at}.url`)} onBlur={touch(`${at}.url`)}
                    onChange={url => onChange({ ...draft, projects: draft.projects.map(p => (p.id === project.id ? { ...p, url } : p)) })}
                  />
                  <div className="we-entry-buttons">
                    <button type="button" className="we-button" disabled={index === 0}
                      aria-label={`Move project ${n} up`} onClick={() => onChange(moveProject(draft, project.id, -1))}>Move up</button>
                    <button type="button" className="we-button" disabled={index === draft.projects.length - 1}
                      aria-label={`Move project ${n} down`} onClick={() => onChange(moveProject(draft, project.id, 1))}>Move down</button>
                    <button type="button" className="we-button" aria-label={`Remove project ${n}`}
                      onClick={() => onChange(removeProject(draft, project.id))}>Remove</button>
                  </div>
                </fieldset>
              )
            })}
            <button
              type="button" className="we-button" disabled={projectBlocked !== null} aria-describedby={projectBlocked ? 'we-projects-limit' : undefined}
              onClick={() => {
                const next = addProject(draft)
                pendingFocus.current = fieldId(`projects[${next.projects.length - 1}].title`)
                onChange(next)
              }}
            >
              Add a project
            </button>
            {projectBlocked && <p id="we-projects-limit" className="we-hint">{projectBlocked}</p>}
          </fieldset>

          <fieldset className="we-group" data-preview="links">
            <legend>Links</legend>
            {errorAt('links') && attempted && <p className="we-error"><span className="we-error-label">Problem: </span>{errorAt('links')}</p>}
            {draft.links.length === 0 && <p className="we-hint">No links yet.</p>}
            {draft.links.map((link, index) => {
              const at = `links[${index}]`
              const n = index + 1
              return (
                <fieldset key={link.id} className="we-entry">
                  <legend>Link {n}</legend>
                  <TextField
                    path={`${at}.label`} label={`Link ${n} name`} value={link.label} limit={SITE_LIMITS.linkLabel.max}
                    error={shown(`${at}.label`)} onBlur={touch(`${at}.label`)}
                    onChange={label => onChange({ ...draft, links: draft.links.map(l => (l.id === link.id ? { ...l, label } : l)) })}
                  />
                  <UrlField
                    path={`${at}.url`} label={`Link ${n} address`} value={link.url}
                    hint="A web address starting with https://" error={shown(`${at}.url`)} onBlur={touch(`${at}.url`)}
                    onChange={url => onChange({ ...draft, links: draft.links.map(l => (l.id === link.id ? { ...l, url } : l)) })}
                  />
                  <div className="we-entry-buttons">
                    <button type="button" className="we-button" disabled={index === 0}
                      aria-label={`Move link ${n} up`} onClick={() => onChange(moveLink(draft, link.id, -1))}>Move up</button>
                    <button type="button" className="we-button" disabled={index === draft.links.length - 1}
                      aria-label={`Move link ${n} down`} onClick={() => onChange(moveLink(draft, link.id, 1))}>Move down</button>
                    <button type="button" className="we-button" aria-label={`Remove link ${n}`}
                      onClick={() => onChange(removeLink(draft, link.id))}>Remove</button>
                  </div>
                </fieldset>
              )
            })}
            <button
              type="button" className="we-button" disabled={linkBlocked !== null} aria-describedby={linkBlocked ? 'we-links-limit' : undefined}
              onClick={() => {
                const next = addLink(draft)
                pendingFocus.current = fieldId(`links[${next.links.length - 1}].label`)
                onChange(next)
              }}
            >
              Add a link
            </button>
            {linkBlocked && <p id="we-links-limit" className="we-hint">{linkBlocked}</p>}
          </fieldset>

          <fieldset className="we-group" data-preview="home">
            <legend>Look</legend>
            <SelectField<ThemePresetId>
              path="theme.preset" label="Theme" value={draft.theme.preset}
              options={THEME_PRESET_IDS.map(id => ({
                value: id,
                label: PRESET_LABELS[id],
                disabled: id === 'custom' && draft.theme.preset !== 'custom',
              }))}
              hint="Choosing a theme sets all the colours, the font and the pattern."
              onChange={id => { if (id !== 'custom') onChange(applyPreset(draft, id as PresetId)) }}
            />
            <ColourField path="theme.background" label="Page colour" value={draft.theme.background}
              error={shown('theme.background')} onBlur={touch('theme.background')}
              onChange={value => onChange(setLook(draft, 'background', value))} />
            <ColourField path="theme.text" label="Text colour" value={draft.theme.text}
              error={shown('theme.text')} onBlur={touch('theme.text')}
              onChange={value => onChange(setLook(draft, 'text', value))} />
            <ColourField path="theme.link" label="Link colour" value={draft.theme.link}
              error={shown('theme.link')} onBlur={touch('theme.link')}
              onChange={value => onChange(setLook(draft, 'link', value))} />
            <ColourField path="theme.headerBackground" label="Banner colour" value={draft.theme.headerBackground}
              error={shown('theme.headerBackground')} onBlur={touch('theme.headerBackground')}
              onChange={value => onChange(setLook(draft, 'headerBackground', value))} />
            <ColourField path="theme.headerText" label="Banner text colour" value={draft.theme.headerText}
              error={shown('theme.headerText')} onBlur={touch('theme.headerText')}
              onChange={value => onChange(setLook(draft, 'headerText', value))} />
            <SelectField<FontId>
              path="theme.font" label="Font" value={draft.theme.font}
              options={FONT_IDS.map(id => ({ value: id, label: FONT_LABELS[id] }))}
              onChange={value => onChange(setLook(draft, 'font', value))}
            />
            <SelectField<PatternId>
              path="theme.pattern" label="Background pattern" value={draft.theme.pattern}
              options={PATTERN_IDS.map(id => ({ value: id, label: PATTERN_LABELS[id] }))}
              onChange={value => onChange(setLook(draft, 'pattern', value))}
            />
            <CheckboxField
              path="theme.underConstruction" label="Show the “under construction” banner"
              checked={draft.theme.underConstruction}
              onChange={on => onChange(setUnderConstruction(draft, on))}
            />

            <table className="we-contrast">
              <caption>How easy the colours are to read (WCAG AA)</caption>
              <thead>
                <tr><th scope="col">Colours</th><th scope="col">Contrast</th><th scope="col">Needs</th><th scope="col">Result</th></tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key} data-passes={row.passes === null ? 'unknown' : String(row.passes)}>
                    <th scope="row">{row.label}</th>
                    <td>{row.ratio ?? 'unknown'}</td>
                    <td>{row.needed}:1{row.size === 'large' ? ' (large text)' : ''}</td>
                    <td>
                      {row.passes === null
                        ? 'Enter both colours as #RRGGBB'
                        : row.passes
                          ? 'Passes AA'
                          : 'Fails AA: change a colour'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        </form>

        <section className="we-preview" aria-label="Live preview">
          <div className="we-preview-bar">
            <span className="we-preview-title">Live preview</span>
            <div role="group" aria-label="Preview page" className="we-preview-pages">
              {SITE_PAGES.map(page => (
                <button
                  key={page.id}
                  type="button"
                  className="we-button"
                  aria-pressed={previewSection === page.id}
                  onClick={() => setPreviewSection(page.id)}
                >
                  {page.label}
                </button>
              ))}
            </div>
          </div>
          {/* Looking only: no tab stops and no clicks inside, so a link here cannot open a new tab. */}
          <div className="we-preview-frame" inert>
            <SiteRenderer site={preview} section={previewSection} onNavigate={setPreviewSection} />
          </div>
        </section>
      </div>

      <div className="we-savebar">
        <p className="we-state" role="status">
          {saving ? 'Saving...' : dirty ? 'You have unsaved changes.' : 'No changes yet.'}
          {!persistent && ` ${NOT_SAVED_NOTICE}`}
        </p>
        <button type="button" className="we-button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" form="we-form" className="we-button we-button--primary" disabled={!dirty || saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
