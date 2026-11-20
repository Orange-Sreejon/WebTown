import { newPageHtml } from './templates'
import { pageNameProblem } from './rules'
import type { SiteAsset, SiteProject, SiteSave, SiteSnapshot } from './types'

/**
 * Everything the Site Studio is editing, as plain data, and every change as
 * a pure reducer action. The draft is compared with the last saved project to
 * know what is unsaved, and the save request is the difference between them.
 */

export type EditorTab = 'html' | 'css'

export interface StudioState {
  /** The project as storage last had it (or the starting point, before the first save). */
  saved: SiteProject
  /** Whether `saved` really is in storage. False for a new or converted website. */
  stored: boolean
  /** The revision a save must start from. */
  baseRevision: number
  /** What the owner is editing. */
  draft: SiteProject
  /** Bytes of every image the draft lists (and of saved ones, for a later rebase), by id. */
  assetData: Readonly<Record<string, SiteAsset>>
  page: string
  tab: EditorTab
}

export type StudioAction =
  | { type: 'edit-html'; page: string; html: string }
  | { type: 'edit-css'; css: string }
  | { type: 'set-title'; title: string }
  | { type: 'select-page'; page: string }
  | { type: 'select-tab'; tab: EditorTab }
  | { type: 'add-page'; name: string }
  | { type: 'rename-page'; from: string; to: string }
  | { type: 'delete-page'; name: string }
  | { type: 'set-home'; name: string }
  | { type: 'add-asset'; asset: SiteAsset }
  | { type: 'delete-asset'; id: string }
  /** Start over from a template, keeping the save history. */
  | { type: 'replace-draft'; project: SiteProject; assets: SiteAsset[] }
  /** The save went through: `project` is what storage now holds. */
  | { type: 'saved'; project: SiteProject }
  /** Throw the draft away and take what storage has (after a conflict: "Reload"). */
  | { type: 'reload'; snapshot: SiteSnapshot }
  /** Keep the draft but save it over what storage has now (after a conflict: "Save anyway"). */
  | { type: 'rebase'; snapshot: SiteSnapshot }
  /** Take this whole state (computed with this reducer, for example by a rebase that is saved at once). */
  | { type: 'restore'; state: StudioState }

const byId = (assets: readonly SiteAsset[]): Record<string, SiteAsset> => Object.fromEntries(assets.map(a => [a.id, a]))

/** A Studio for a website: `stored` says whether it is already in storage. */
export function startStudio(snapshot: SiteSnapshot, options: { stored: boolean; baseRevision?: number }): StudioState {
  const project = snapshot.project
  return {
    saved: project,
    stored: options.stored,
    baseRevision: options.baseRevision ?? project.revision,
    draft: project,
    assetData: byId(snapshot.assets),
    page: project.homePage,
    tab: 'html',
  }
}

const pageNames = (p: SiteProject): string[] => p.pages.map(page => page.name)

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  const { draft } = state
  const withDraft = (change: Partial<SiteProject>): StudioState => ({ ...state, draft: { ...draft, ...change } })

  switch (action.type) {
    case 'edit-html':
      if (!draft.pages.some(p => p.name === action.page)) return state
      return withDraft({ pages: draft.pages.map(p => (p.name === action.page ? { ...p, html: action.html } : p)) })
    case 'edit-css':
      return withDraft({ css: action.css })
    case 'set-title':
      return withDraft({ title: action.title })
    case 'select-page':
      return draft.pages.some(p => p.name === action.page) ? { ...state, page: action.page, tab: 'html' } : state
    case 'select-tab':
      return { ...state, tab: action.tab }
    case 'add-page': {
      if (pageNameProblem(action.name, pageNames(draft)) !== null) return state
      return { ...withDraft({ pages: [...draft.pages, { name: action.name, html: newPageHtml(action.name) }] }), page: action.name, tab: 'html' }
    }
    case 'rename-page': {
      const others = pageNames(draft).filter(n => n !== action.from)
      if (!draft.pages.some(p => p.name === action.from) || pageNameProblem(action.to, others) !== null) return state
      const next = withDraft({
        pages: draft.pages.map(p => (p.name === action.from ? { ...p, name: action.to } : p)),
        homePage: draft.homePage === action.from ? action.to : draft.homePage,
      })
      return { ...next, page: state.page === action.from ? action.to : state.page }
    }
    case 'delete-page': {
      if (draft.pages.length <= 1 || !draft.pages.some(p => p.name === action.name)) return state
      const pages = draft.pages.filter(p => p.name !== action.name)
      const homePage = draft.homePage === action.name ? pages[0]!.name : draft.homePage
      const next = withDraft({ pages, homePage })
      return { ...next, page: state.page === action.name ? homePage : state.page }
    }
    case 'set-home':
      return draft.pages.some(p => p.name === action.name) ? withDraft({ homePage: action.name }) : state
    case 'add-asset': {
      const { asset } = action
      const meta = { id: asset.id, name: asset.name, mimeType: asset.mimeType, size: asset.size }
      if (draft.assets.some(a => a.id === asset.id || a.name.toLowerCase() === asset.name.toLowerCase())) return state
      return { ...withDraft({ assets: [...draft.assets, meta] }), assetData: { ...state.assetData, [asset.id]: asset } }
    }
    case 'delete-asset':
      return withDraft({ assets: draft.assets.filter(a => a.id !== action.id) })
    case 'replace-draft': {
      const project: SiteProject = { ...action.project, houseId: draft.houseId, revision: draft.revision, createdAt: draft.createdAt }
      return { ...state, draft: project, assetData: { ...state.assetData, ...byId(action.assets) }, page: project.homePage, tab: 'html' }
    }
    case 'saved': {
      const savedProject = action.project
      // Edits made while the save was in flight stay in the draft.
      const next: StudioState = {
        ...state,
        saved: savedProject,
        stored: true,
        baseRevision: savedProject.revision,
        draft: { ...draft, revision: savedProject.revision, updatedAt: savedProject.updatedAt, createdAt: savedProject.createdAt },
      }
      return next
    }
    case 'reload':
      return startStudio(action.snapshot, { stored: true })
    case 'restore':
      return action.state
    case 'rebase':
      return {
        ...state,
        saved: action.snapshot.project,
        stored: true,
        baseRevision: action.snapshot.project.revision,
        assetData: { ...byId(action.snapshot.assets), ...state.assetData },
      }
  }
}

/** What would be lost by leaving now. */
export function isDirty(state: StudioState): boolean {
  if (!state.stored) return true
  const a = state.draft
  const b = state.saved
  if (a.title !== b.title || a.homePage !== b.homePage || a.css !== b.css) return true
  if (a.pages.length !== b.pages.length || a.pages.some((p, i) => p.name !== b.pages[i]!.name || p.html !== b.pages[i]!.html)) return true
  if (a.assets.length !== b.assets.length || a.assets.some((x, i) => x.id !== b.assets[i]!.id || x.name !== b.assets[i]!.name)) return true
  return false
}

/** Pages whose HTML differs from the saved version (or that are new). */
export function unsavedPages(state: StudioState): Set<string> {
  const saved = new Map(state.saved.pages.map(p => [p.name, p.html]))
  return new Set(state.draft.pages.filter(p => !state.stored || saved.get(p.name) !== p.html).map(p => p.name))
}

/** The save that turns storage's version into the draft. */
export function saveRequest(state: StudioState): SiteSave {
  const savedIds = new Set(state.stored ? state.saved.assets.map(a => a.id) : [])
  const draftIds = new Set(state.draft.assets.map(a => a.id))
  return {
    project: state.draft,
    baseRevision: state.baseRevision,
    putAssets: state.draft.assets.filter(a => !savedIds.has(a.id)).map(a => state.assetData[a.id]!).filter(Boolean),
    deleteAssetIds: [...savedIds].filter(id => !draftIds.has(id)),
  }
}

/** The images of the draft, with their bytes, for the preview. */
export const draftAssets = (state: StudioState): SiteAsset[] =>
  state.draft.assets.map(a => state.assetData[a.id]).filter((a): a is SiteAsset => a !== undefined).map(a => ({ ...a, name: state.draft.assets.find(m => m.id === a.id)!.name }))

/** Pages and the stylesheet that mention an image, so deleting it can warn. */
export function assetUsedIn(project: Pick<SiteProject, 'pages' | 'css'>, name: string): string[] {
  const needle = name.toLowerCase()
  const used = project.pages.filter(p => p.html.toLowerCase().includes(needle)).map(p => p.name)
  if (project.css.toLowerCase().includes(needle)) used.push('style.css')
  return used
}
