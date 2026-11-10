import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

/**
 * React error boundary — catches render/lifecycle errors and shows a
 * human-readable fallback instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.'
    return { hasError: true, message }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[WebTown] Uncaught error:', error, info)
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.box}>
            <h1 style={styles.heading}>WebTown crashed</h1>
            <p style={styles.message}>{this.state.message}</p>
            <button
              style={styles.button}
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100vw',
    height: '100vh',
    background: '#1a1a2e',
    color: '#eee',
  } as const,
  box: {
    maxWidth: 480,
    padding: '2rem',
    background: '#16213e',
    borderRadius: 8,
    border: '1px solid #e94560',
    textAlign: 'center' as const,
  },
  heading: {
    margin: '0 0 1rem',
    fontSize: '1.5rem',
    color: '#e94560',
    fontFamily: 'monospace',
  } as const,
  message: {
    margin: '0 0 1.5rem',
    fontSize: '0.9rem',
    lineHeight: 1.6,
    color: '#ccc',
    fontFamily: 'monospace',
    wordBreak: 'break-word' as const,
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
  } as const,
}
