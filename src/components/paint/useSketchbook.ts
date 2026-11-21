import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_TITLE, type Artwork } from '../../personal-spaces/artwork-storage/artwork'
import type { ArtworkList, ArtworkReader, ArtworkWriter } from '../../personal-spaces/artwork-storage/artwork-repository'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import { baseColor } from '../../personal-spaces/paint/color'
import type { PaintSession } from '../../personal-spaces/paint/paint-session'
import { createBuffer } from '../../personal-spaces/paint/pixel-buffer'
import type { PngCodec } from './png-codec'

export const AUTOSAVE_MS = 1500
export const NEW_WIDTH = 640
export const NEW_HEIGHT = 480

export type SaveState = 'new' | 'saved' | 'unsaved' | 'saving' | 'failed'

export interface SketchbookDeps {
  houseId: string
  reader: ArtworkReader
  writer: ArtworkWriter
  codec: PngCodec
  session: PaintSession
  autosaveMs?: number
}

export interface Sketchbook {
  status: 'loading' | 'ready'
  id: string | null
  title: string
  saveState: SaveState
  /** Why the last save failed, in words. */
  saveError: string | null
  /** Drawings that could not be opened, in words. */
  problems: string[]
  /** Saves now if anything changed. Resolves false if the save failed. */
  save(): Promise<boolean>
  newDrawing(): Promise<boolean>
  open(artwork: Artwork): Promise<boolean>
  rename(title: string): Promise<boolean>
  remove(): Promise<boolean>
  list(): Promise<ArtworkList>
  hasUnsavedWork(): boolean
}

const describe = (error: unknown): string =>
  error instanceof PersonalSpacesError ? error.message : 'Your browser could not save the drawing. Please try again.'

/**
 * The drawing that is open and where it is kept. Work is saved without asking:
 * shortly after every change, before New and Open, and when the Sketchbook
 * closes. Only the owner's window uses this (it holds the writer).
 */
export function useSketchbook({ houseId, reader, writer, codec, session, autosaveMs = AUTOSAVE_MS }: SketchbookDeps): Sketchbook {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [doc, setDoc] = useState<{ id: string | null; title: string }>({ id: null, title: DEFAULT_TITLE })
  const [saveState, setSaveState] = useState<SaveState>('new')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const docRef = useRef(doc)
  docRef.current = doc
  const savedRevision = useRef(session.revision)
  const titleChanged = useRef(false)
  const saving = useRef<Promise<boolean> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loaded = useRef(false)

  const dirty = useCallback(() => session.revision !== savedRevision.current || titleChanged.current, [session])

  const setDocBoth = (next: { id: string | null; title: string }): void => {
    docRef.current = next
    setDoc(next)
  }

  const stopTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  const saveNow = useCallback(async (): Promise<boolean> => {
    stopTimer()
    if (saving.current) {
      await saving.current
      return dirty() ? saveNow() : true
    }
    if (!dirty()) return true
    const run = (async (): Promise<boolean> => {
      const revision = session.revision
      const titleAtSave = docRef.current.title
      setSaveState('saving')
      try {
        const png = await codec.encode(session.image)
        const summary = await writer.save({
          id: docRef.current.id,
          houseId,
          title: docRef.current.title,
          width: session.width,
          height: session.height,
          transparent: session.base === 'transparent',
          png,
        })
        savedRevision.current = revision
        if (docRef.current.title === titleAtSave) titleChanged.current = false
        setDocBoth({ id: summary.id, title: docRef.current.title })
        setSaveError(null)
        setSaveState(dirty() ? 'unsaved' : 'saved')
        return true
      } catch (error) {
        console.error('[WebTown] The drawing could not be saved.', error)
        setSaveError(describe(error))
        setSaveState('failed')
        return false
      } finally {
        saving.current = null
      }
    })()
    saving.current = run
    const ok = await run
    if (ok && dirty()) schedule()
    return ok
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codec, dirty, houseId, session, writer])

  const schedule = useCallback(() => {
    stopTimer()
    timer.current = setTimeout(function tick() {
      // Never save half a stroke: wait for the press to finish.
      if (session.busy) { timer.current = setTimeout(tick, autosaveMs); return }
      void saveNow()
    }, autosaveMs)
  }, [autosaveMs, saveNow, session])

  // Every committed change marks the drawing unsaved and schedules a save.
  useEffect(() => {
    let seen = session.revision
    return session.onChange(() => {
      if (!loaded.current || session.revision === seen) return
      seen = session.revision
      if (dirty()) {
        setSaveState(state => (state === 'saving' ? state : 'unsaved'))
        schedule()
      }
    })
  }, [session, dirty, schedule])

  const show = useCallback(async (artwork: Artwork): Promise<void> => {
    const image = await codec.decode(artwork.png)
    if (image.width !== artwork.width || image.height !== artwork.height) throw new Error('The image is not the size it should be.')
    session.load(image, artwork.transparent ? 'transparent' : 'white')
    savedRevision.current = session.revision
    titleChanged.current = false
    setDocBoth({ id: artwork.id, title: artwork.title })
    setSaveState('saved')
    setSaveError(null)
  }, [codec, session])

  const startBlank = useCallback(() => {
    session.load(createBuffer(NEW_WIDTH, NEW_HEIGHT, baseColor('white')), 'white')
    savedRevision.current = session.revision
    titleChanged.current = false
    setDocBoth({ id: null, title: DEFAULT_TITLE })
    setSaveState('new')
    setSaveError(null)
  }, [session])

  // Opening the Sketchbook: the most recently changed drawing, or a blank page.
  useEffect(() => {
    let current = true
    void (async () => {
      const found: string[] = []
      try {
        const list = await reader.list(houseId)
        found.push(...list.skipped)
        for (const artwork of list.items) {
          try {
            if (!current) return
            await show(artwork)
            break
          } catch (error) {
            console.error('[WebTown] A drawing could not be opened.', error)
            found.push(`${artwork.title} could not be opened.`)
          }
        }
      } catch (error) {
        console.error('[WebTown] The Sketchbook could not be read.', error)
        found.push(describe(error))
      }
      if (!current) return
      if (docRef.current.id === null) startBlank()
      setProblems(found)
      loaded.current = true
      setStatus('ready')
    })()
    return () => {
      current = false
    }
    // Opened once per window; a different house is a different window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The browser asks before the tab closes with work that is not stored yet.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirty() && !saving.current) return
      void saveNow()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, saveNow])

  useEffect(() => () => stopTimer(), [])

  const newDrawing = useCallback(async (): Promise<boolean> => {
    if (!(await saveNow())) return false
    startBlank()
    return true
  }, [saveNow, startBlank])

  const open = useCallback(async (artwork: Artwork): Promise<boolean> => {
    if (artwork.id === docRef.current.id) return true
    if (!(await saveNow())) return false
    try {
      await show(artwork)
      return true
    } catch (error) {
      console.error('[WebTown] A drawing could not be opened.', error)
      setProblems(p => [...p, `${artwork.title} could not be opened.`])
      return false
    }
  }, [saveNow, show])

  const rename = useCallback(async (title: string): Promise<boolean> => {
    setDocBoth({ ...docRef.current, title })
    titleChanged.current = true
    return saveNow()
  }, [saveNow])

  const remove = useCallback(async (): Promise<boolean> => {
    stopTimer()
    if (saving.current) await saving.current
    const id = docRef.current.id
    try {
      if (id !== null) await writer.delete(houseId, id)
    } catch (error) {
      setSaveError(describe(error))
      setSaveState('failed')
      return false
    }
    const list = await reader.list(houseId).catch(() => ({ items: [] as Artwork[], skipped: [] }))
    const next = list.items.find(item => item.id !== id)
    try {
      if (next) await show(next)
      else startBlank()
    } catch {
      startBlank()
    }
    return true
  }, [houseId, reader, show, startBlank, writer])

  const list = useCallback(() => reader.list(houseId), [reader, houseId])

  return {
    status,
    id: doc.id,
    title: doc.title,
    saveState,
    saveError,
    problems,
    save: saveNow,
    newDrawing,
    open,
    rename,
    remove,
    list,
    hasUnsavedWork: () => dirty() || saving.current !== null,
  }
}
