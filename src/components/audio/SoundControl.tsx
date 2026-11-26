import { useEffect, useId, useState } from 'react'
import { gameAudio, type AudioSettings } from '../../audio'
import { onAppState } from '../../lib/app-bridge'
import { onEditorState } from '../../lib/editor-bridge'
import { loadAudioSettings, saveAudioSettings } from '../../personal-spaces/storage/audio-preferences'
import { KeyboardShield } from '../account/KeyboardShield'
import './audio.css'

type Level = 'master' | 'ambient' | 'effects'
const LEVELS: Array<{ key: Level; label: string }> = [
  { key: 'master', label: 'Volume' },
  { key: 'ambient', label: 'Ambience' },
  { key: 'effects', label: 'Sound effects' },
]

/**
 * The sound settings (decision A8): a small speaker button over the game, opening mute and three volume sliders.
 * Settings are applied at once (gains only, nothing restarts) and saved on this device. Steps aside while the
 * website, the Sketchbook or the furniture editor is open.
 */
export function SoundControl(): React.ReactElement | null {
  const [settings, setSettings] = useState<AudioSettings>(() => loadAudioSettings())
  const [open, setOpen] = useState(false)
  const [covered, setCovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const id = useId()

  useEffect(() => { gameAudio.setSettings(settings) }, [settings])
  useEffect(() => onAppState(view => setCovered(view.open !== null)), [])
  useEffect(() => onEditorState(view => setEditing(view.mode === 'edit')), [])

  const change = (next: AudioSettings): void => {
    setSettings(next)
    saveAudioSettings(next)
  }

  if (covered || editing) return null
  const silent = settings.muted || settings.master === 0
  return (
    <div className="au-control">
      {open && (
        <KeyboardShield>
          <div className="au-panel" id={`${id}-panel`} role="group" aria-label="Sound settings">
            <label className="au-row au-mute">
              <input type="checkbox" checked={settings.muted} onChange={e => change({ ...settings, muted: e.target.checked })} />
              <span>Mute</span>
            </label>
            {LEVELS.map(({ key, label }) => (
              <label key={key} className="au-row">
                <span>{label}</span>
                <input
                  type="range" min={0} max={100} step={1}
                  value={Math.round(settings[key] * 100)}
                  disabled={settings.muted}
                  aria-valuetext={`${Math.round(settings[key] * 100)}%`}
                  onChange={e => change({ ...settings, [key]: Number(e.target.value) / 100 })}
                />
              </label>
            ))}
            <p className="au-note">Sound starts after your first click or key press.</p>
          </div>
        </KeyboardShield>
      )}
      <button
        type="button" className="au-button" aria-expanded={open} aria-controls={`${id}-panel`}
        aria-label={open ? 'Close sound settings' : 'Sound settings'} title="Sound"
        onClick={() => setOpen(o => !o)}
      >
        {silent ? '🔇' : '🔊'}
      </button>
    </div>
  )
}
