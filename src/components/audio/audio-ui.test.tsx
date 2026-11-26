import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gameAudio, DEFAULT_AUDIO_SETTINGS } from '../../audio'
import { HIDDEN_APP_VIEW, emitAppState } from '../../lib/app-bridge'
import { loadAudioSettings, parseAudioSettings, saveAudioSettings } from '../../personal-spaces/storage/audio-preferences'
import { AppSounds } from './AppSounds'
import { SoundControl } from './SoundControl'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let played: string[]

beforeEach(() => {
  window.localStorage.clear()
  played = []
  vi.spyOn(gameAudio, 'play').mockImplementation(name => { played.push(name); return true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  emitAppState(HIDDEN_APP_VIEW)
  vi.restoreAllMocks()
})

const open = (app: 'website' | 'paint' | null): void => act(() => emitAppState(app ? { open: app, houseId: 'house-a', mode: 'owner' } : HIDDEN_APP_VIEW))

describe('saved sound settings', () => {
  it('start quiet, and survive a reload', () => {
    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS)
    expect(DEFAULT_AUDIO_SETTINGS.master).toBeLessThanOrEqual(0.6)
    saveAudioSettings({ master: 0.3, ambient: 0.1, effects: 0.8, muted: true })
    expect(loadAudioSettings()).toEqual({ master: 0.3, ambient: 0.1, effects: 0.8, muted: true })
  })

  it('fall back to the defaults for anything damaged', () => {
    expect(parseAudioSettings('not json')).toEqual(DEFAULT_AUDIO_SETTINGS)
    expect(parseAudioSettings('[1,2]')).toEqual(DEFAULT_AUDIO_SETTINGS)
    expect(parseAudioSettings('{"master":5,"ambient":"loud","effects":-2,"muted":"yes"}'))
      .toEqual({ master: 1, ambient: DEFAULT_AUDIO_SETTINGS.ambient, effects: 0, muted: false })
  })
})

describe('AppSounds', () => {
  it('turns the computer on and off once per opening, and opens and closes the Sketchbook once', () => {
    act(() => root.render(<AppSounds />))
    open('website')
    open('website') // the same state again: nothing
    open(null)
    open('paint')
    open(null)
    open(null)
    expect(played).toEqual(['computer-on', 'computer-off', 'page-turn', 'book-close'])
  })

  it('clicks for real key presses in the website editor only, never while idle or elsewhere', () => {
    act(() => root.render(<AppSounds />))
    const studio = document.createElement('div')
    studio.className = 'ws-studio'
    const field = document.createElement('textarea')
    studio.appendChild(field)
    document.body.appendChild(studio)
    const press = (key: string, target: EventTarget = field, extra: KeyboardEventInit = {}) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }))

    press('a') // website not open
    open('website')
    press('a')
    press('Enter')
    press('Shift')
    press('s', field, { ctrlKey: true })
    press('b', document.body)
    expect(played.filter(p => p === 'key')).toHaveLength(2)
    studio.remove()
  })

  it('draws with a pencil sound only while a stroke moves on the canvas', () => {
    act(() => root.render(<AppSounds />))
    const canvas = document.createElement('canvas')
    canvas.className = 'pt-canvas'
    document.body.appendChild(canvas)
    // jsdom has no PointerEvent; a MouseEvent with the pointer event's name carries the same fields used here.
    const pointer = (type: string, x: number, buttons: number, target: EventTarget = canvas) =>
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, buttons }))
    open('paint')
    pointer('pointermove', 50, 0) // hovering
    pointer('pointerdown', 10, 1)
    pointer('pointermove', 11, 1) // too small a move
    pointer('pointermove', 30, 1)
    pointer('pointermove', 60, 1)
    pointer('pointerup', 60, 0)
    pointer('pointermove', 90, 0)
    pointer('pointerdown', 10, 1, document.body) // not on the canvas
    pointer('pointermove', 80, 1)
    expect(played.filter(p => p === 'pencil')).toHaveLength(2)
    canvas.remove()
  })

  it('stops listening when unmounted', () => {
    act(() => root.render(<AppSounds />))
    act(() => root.unmount())
    root = createRoot(container)
    open('website')
    expect(played).toEqual([])
  })
})

describe('SoundControl', () => {
  it('applies the saved settings at once, and saves every change', () => {
    saveAudioSettings({ master: 0.4, ambient: 0.2, effects: 0.7, muted: false })
    const apply = vi.spyOn(gameAudio, 'setSettings')
    act(() => root.render(<SoundControl />))
    expect(apply).toHaveBeenLastCalledWith({ master: 0.4, ambient: 0.2, effects: 0.7, muted: false })

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Sound settings"]')!.click())
    const mute = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => mute.click())
    expect(loadAudioSettings().muted).toBe(true)
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true }))
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="range"]')].every(r => r.disabled)).toBe(true)
    expect(container.querySelector('button')!.textContent).toBe('🔇')
  })

  it('steps aside while an app is open', () => {
    act(() => root.render(<SoundControl />))
    expect(container.querySelector('.au-control')).not.toBeNull()
    open('paint')
    expect(container.querySelector('.au-control')).toBeNull()
    open(null)
    expect(container.querySelector('.au-control')).not.toBeNull()
  })
})
