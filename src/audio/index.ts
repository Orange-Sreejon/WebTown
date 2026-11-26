import { AudioEngine, type ContextLike } from './audio-engine'

/**
 * The one audio engine for the whole app, shared by the Phaser scenes and the React windows. Created silent and
 * locked; GameContainer installs the gesture and visibility listeners and applies the saved settings.
 */
export const gameAudio = new AudioEngine({
  createContext: () => {
    const Ctor = typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    if (!Ctor) return null
    try {
      return new Ctor({ latencyHint: 'interactive' }) as unknown as ContextLike
    } catch {
      return null
    }
  },
})

export type { AudioSettings, SoundName } from './audio-engine'
export { DEFAULT_AUDIO_SETTINGS } from './audio-engine'
