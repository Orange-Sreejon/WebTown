import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '../../audio/audio-engine'

/**
 * The sound settings of this device (master, ambience and effects volume, mute). A preference of this browser,
 * kept in localStorage and never sent anywhere. Anything unreadable falls back to the quiet defaults.
 */
const KEY = 'webtown.audio'

const level = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback

/** Parses a stored value; unknown or damaged fields take the default. */
export function parseAudioSettings(raw: string | null): AudioSettings {
  const d = DEFAULT_AUDIO_SETTINGS
  if (!raw) return { ...d }
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return { ...d }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...d }
  const r = v as Record<string, unknown>
  return {
    master: level(r['master'], d.master),
    ambient: level(r['ambient'], d.ambient),
    effects: level(r['effects'], d.effects),
    muted: r['muted'] === true,
  }
}

export function loadAudioSettings(): AudioSettings {
  try {
    return parseAudioSettings(window.localStorage.getItem(KEY))
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS }
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      master: settings.master, ambient: settings.ambient, effects: settings.effects, muted: settings.muted,
    }))
  } catch {
    // Storage blocked: the settings last for this tab.
  }
}
