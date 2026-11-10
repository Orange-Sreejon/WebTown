/**
 * Shown while Phaser's BootScene is loading assets.
 * Disappears once the READY event fires from the game.
 */
export function LoadingScreen(): React.ReactElement {
  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        <div style={styles.title}>WebTown</div>
        <div style={styles.subtitle}>Loading…</div>
        <div style={styles.spinner} aria-hidden="true" />
      </div>
    </div>
  )
}

// Inline styles — no CSS module dependency required for a simple loading screen
const styles = {
  container: {
    position: 'fixed' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1a2f1a',
    zIndex: 10,
  },
  inner: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.75rem',
  },
  title: {
    fontFamily: 'monospace',
    fontSize: '2.5rem',
    fontWeight: 'bold',
    color: '#7ec850',
    letterSpacing: '0.05em',
  },
  subtitle: {
    fontFamily: 'monospace',
    fontSize: '1rem',
    color: '#aaa',
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #3a5a3a',
    borderTop: '3px solid #7ec850',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
} as const

// Inject the keyframe for the spinner once
const styleTag = document.createElement('style')
styleTag.textContent = '@keyframes spin { to { transform: rotate(360deg); } }'
document.head.appendChild(styleTag)
