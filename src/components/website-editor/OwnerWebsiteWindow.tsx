import { useCallback, useEffect, useRef, useState } from 'react'
import { PersonalSpacesError, PermissionError, ValidationError } from '../../personal-spaces/errors'
import { SAVED_LOCAL_NOTICE, SAVED_MEMORY_NOTICE } from '../../personal-spaces/labels'
import { isDirty, startDraft } from '../../personal-spaces/website/site-edit'
import type { SiteReader, SiteWriter } from '../../personal-spaces/website/site-repository'
import type { ReadonlySiteContent, SiteContent } from '../../personal-spaces/website/site-types'
import { validateSite } from '../../personal-spaces/website/site-validation'
import { WindowFrame } from '../apps/WindowFrame'
import { SiteBrowser, type RecoveryNotice } from '../website/SiteBrowser'
import { ConfirmDialog } from './ConfirmDialog'
import { SiteEditor } from './SiteEditor'
import './website-editor.css'

interface OwnerWebsiteWindowProps {
  houseId: string
  reader: SiteReader
  /**
   * The only thing in the website windows that can change a website. It is
   * given here and nowhere else, and only when the app bridge said `owner`.
   */
  writer: SiteWriter
  persistent: boolean
  recovery: RecoveryNotice | null
  onClose: () => void
}

type Mode = { kind: 'view' } | { kind: 'edit'; original: ReadonlySiteContent }

/** A failed save, as a sentence. The detail goes to the console. */
function describeSaveFailure(error: unknown): string {
  if (error instanceof ValidationError) return error.issues.map(issue => issue.message).join(' ') || error.message
  if (error instanceof PermissionError || error instanceof PersonalSpacesError) return error.message
  return 'Something went wrong while saving.'
}

/** The "Edit" button. Takes focus back after an edit ends, once the page has loaded. */
function EditButton({
  site,
  takeFocus,
  onFocused,
  onEdit,
}: {
  site: ReadonlySiteContent | null
  takeFocus: boolean
  onFocused: () => void
  onEdit: (site: ReadonlySiteContent) => void
}): React.ReactElement {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (takeFocus && site !== null) {
      ref.current?.focus()
      onFocused()
    }
  }, [takeFocus, site, onFocused])
  return (
    <button
      type="button"
      className="wt-tool we-edit-button"
      ref={ref}
      disabled={site === null}
      onClick={() => site && onEdit(site)}
    >
      Edit this website
    </button>
  )
}

/**
 * The window the owner of a house gets: the same browser a visitor sees, plus
 * an "Edit this website" button that swaps the page for the editor.
 *
 * Editing works on a copy. Nothing reaches storage until Save, which checks
 * the whole draft and writes it through the `SiteWriter` this window was given.
 * Cancel and Close ask first if there is anything to lose. A failed save keeps
 * the draft and says why. After a successful save the normal browser opens and
 * loads the website back from storage, so what is shown is what was saved.
 *
 * Phase 3a: "owner" is a client-side stand-in decided by the game. Anyone with
 * browser developer tools can bypass it, and the saved data is only on this
 * device.
 */
export function OwnerWebsiteWindow({
  houseId,
  reader,
  writer,
  persistent,
  recovery,
  onClose,
}: OwnerWebsiteWindowProps): React.ReactElement {
  const [mode, setMode] = useState<Mode>({ kind: 'view' })
  const [draft, setDraft] = useState<SiteContent | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null)
  const [focusEdit, setFocusEdit] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const editing = mode.kind === 'edit' && draft !== null
  const dirty = mode.kind === 'edit' && draft !== null && isDirty(mode.original, draft)

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const begin = useCallback((site: ReadonlySiteContent): void => {
    setDraft(startDraft(site))
    setMode({ kind: 'edit', original: site })
    setSaveError(null)
    setAttempt(0)
    setNotice(null)
  }, [])

  const endEditing = useCallback((): void => {
    setMode({ kind: 'view' })
    setDraft(null)
    setSaveError(null)
    setAttempt(0)
    setConfirm(null)
    setFocusEdit(true)
  }, [])

  const save = async (): Promise<void> => {
    if (draft === null || saving) return

    // Everything is checked again, here, with the same function the store uses.
    const checked = validateSite(draft)
    if (!checked.ok) {
      setAttempt(n => n + 1)
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      await writer.save(checked.value)
    } catch (error) {
      console.error('[WebTown] The website could not be saved.', error)
      if (mounted.current) {
        setSaveError(describeSaveFailure(error))
        setSaving(false)
      }
      return
    }
    if (!mounted.current) return
    setSaving(false)
    setNotice(persistent ? SAVED_LOCAL_NOTICE : SAVED_MEMORY_NOTICE)
    endEditing()
  }

  // Close, Escape and Cancel all go through here. Nothing is lost without asking.
  const requestClose = (): void => {
    if (confirm !== null) {
      setConfirm(null) // Escape on the question means "keep editing"
      return
    }
    if (dirty && !saving) {
      setConfirm('close')
      return
    }
    onClose()
  }

  const requestCancel = (): void => {
    if (dirty) setConfirm('cancel')
    else endEditing()
  }

  const discard = (): void => {
    if (confirm === 'close') onClose()
    else endEditing()
  }

  return (
    <WindowFrame
      title={editing ? 'WebTown Browser - Editing' : 'WebTown Browser'}
      onClose={requestClose}
      size="wide"
    >
      <div className="we-window" inert={confirm !== null}>
        {editing && draft !== null ? (
          <SiteEditor
            draft={draft}
            onChange={setDraft}
            dirty={dirty}
            saving={saving}
            saveError={saveError}
            attempt={attempt}
            persistent={persistent}
            onSave={() => void save()}
            onCancel={requestCancel}
          />
        ) : (
          <SiteBrowser
            houseId={houseId}
            reader={reader}
            isOwner
            persistent={persistent}
            recovery={recovery}
            notice={notice}
            actions={site => (
              <EditButton
                site={site}
                takeFocus={focusEdit}
                onFocused={() => setFocusEdit(false)}
                onEdit={begin}
              />
            )}
          />
        )}
      </div>

      {confirm !== null && (
        <ConfirmDialog
          title="Discard your changes?"
          message={
            confirm === 'close'
              ? 'You have unsaved changes. If you close now they will be lost.'
              : 'You have unsaved changes. If you cancel now they will be lost.'
          }
          keepLabel="Keep editing"
          discardLabel="Discard changes"
          onKeep={() => setConfirm(null)}
          onDiscard={discard}
        />
      )}
    </WindowFrame>
  )
}
