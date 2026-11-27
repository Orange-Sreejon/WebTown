import { useEffect } from 'react'
import { gameAudio } from '../../audio'
import { onAppState, type AppId } from '../../lib/app-bridge'

/** The keys that type something (a click per real key press, never while idle). */
const TYPING_KEY = /^(.|Enter|Backspace|Delete|Tab)$/

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  if (!el.closest('.ws-studio, [role="dialog"]')) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}

/** Minimum pointer travel (px) between two pencil sounds, so a still pen is silent. */
const PENCIL_TRAVEL_PX = 4

/**
 * The computer's and the Sketchbook's sounds (decision A5): on and off as the window opens and closes, a soft click
 * per key pressed in the website editor's fields, a page turn when the Sketchbook opens, a closing book when it
 * closes, and a pencil only while a stroke is being drawn. Renders nothing.
 */
export function AppSounds(): null {
  useEffect(() => {
    let open: AppId | null = null
    let drawing = false
    let lastX = 0
    let lastY = 0

    const stopApp = onAppState(view => {
      const next = view.open
      if (next === open) return
      if (open === 'website' || open === 'community-website') gameAudio.play('computer-off')
      if (open === 'paint') gameAudio.play('book-close')
      if (next === 'website' || next === 'community-website') gameAudio.play('computer-on')
      if (next === 'paint') gameAudio.play('page-turn')
      open = next
      drawing = false
    })

    const onKey = (event: KeyboardEvent): void => {
      if (open !== 'website' || event.ctrlKey || event.metaKey || event.altKey) return
      if (!TYPING_KEY.test(event.key) || !isTypingTarget(event.target)) return
      gameAudio.play('key')
    }
    const onCanvas = (target: EventTarget | null): boolean =>
      open === 'paint' && (target as HTMLElement | null)?.classList?.contains('pt-canvas') === true
    const onDown = (event: PointerEvent): void => {
      if (!onCanvas(event.target)) return
      drawing = true
      lastX = event.clientX
      lastY = event.clientY
    }
    const onMove = (event: PointerEvent): void => {
      if (!drawing || open !== 'paint' || event.buttons === 0) {
        drawing = false
        return
      }
      if (Math.hypot(event.clientX - lastX, event.clientY - lastY) < PENCIL_TRAVEL_PX) return
      lastX = event.clientX
      lastY = event.clientY
      gameAudio.play('pencil')
    }
    const onUp = (): void => { drawing = false }

    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
    return () => {
      stopApp()
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onUp, true)
    }
  }, [])
  return null
}
