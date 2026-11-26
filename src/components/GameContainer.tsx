import { useEffect, useRef, useState } from 'react'
import type Phaser from 'phaser'
import { createPhaserGame } from '../game/create-game'
import { findAvailableSheets } from '../game/systems/avatars'
import { on, off } from '../lib/event-bus'
import { LoadingScreen } from './LoadingScreen'
import { HouseEditorOverlay } from './house-editor/HouseEditorOverlay'
import { AppHost } from './apps/AppHost'
import { AppSounds } from './audio/AppSounds'
import { SoundControl } from './audio/SoundControl'
import { gameAudio } from '../audio'

/**
 * Mounts the Phaser canvas and owns the game instance lifecycle.
 *
 * Notes:
 * - StrictMode is disabled in main.tsx because Phaser cannot survive the
 *   dev-mode double mount/unmount cycle.
 * - The `mounted` flag inside useEffect prevents the rare case where cleanup
 *   fires after the READY/ERROR event resolves asynchronously.
 */
export function GameContainer(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Audio starts on the first click or key press (browsers allow nothing sooner) and pauses while the tab is hidden.
  useEffect(() => gameAudio.install(window, document), [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || gameRef.current) return

    let mounted = true

    const handleReady = (): void => {
      if (mounted) setLoading(false)
    }

    const handleError = (e: CustomEvent<unknown>): void => {
      if (!mounted) return
      const msg = typeof e.detail === 'string' ? e.detail : 'Asset failed to load.'
      setError(msg)
      setLoading(false)
    }

    on('READY', handleReady)
    on('ERROR', handleError as (e: CustomEvent<unknown>) => void)

    // Optional character sheets are checked first, so the loader only queues files that exist.
    void findAvailableSheets().then(() => {
      if (!mounted) return
      gameRef.current = createPhaserGame(el)
    })

    return () => {
      mounted = false
      off('READY', handleReady)
      off('ERROR', handleError as (e: CustomEvent<unknown>) => void)
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
      }
    }
  }, [])

  if (error) {
    return (
      <div style={styles.error}>
        <p style={styles.errorText}>Failed to load WebTown: {error}</p>
        <button style={styles.button} onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={styles.wrapper}>
      <div
        ref={containerRef}
        style={styles.game}
        aria-label="WebTown — interactive game canvas"
        role="application"
      />
      {loading && <LoadingScreen />}
      <HouseEditorOverlay />
      <SoundControl />
      <AppSounds />
      <AppHost />
    </div>
  )
}

const styles = {
  wrapper: {
    position: 'fixed' as const,
    inset: 0,
    background: '#000',
    overflow: 'hidden',
  },
  // Full-size mount target for Phaser. Must have explicit dimensions so
  // Phaser.Scale.EXPAND can read them on init.
  game: {
    width: '100vw',
    height: '100vh',
  },
  error: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100vw',
    height: '100vh',
    background: '#1a1a1a',
    color: '#fff',
    gap: '1rem',
  },
  errorText: {
    fontFamily: 'monospace',
    fontSize: '1rem',
    color: '#e94560',
    margin: 0,
  },
  button: {
    padding: '0.5rem 1.5rem',
    background: '#e94560',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '1rem',
  },
} as const
