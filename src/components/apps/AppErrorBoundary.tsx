import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Called once when something inside throws, so the app can be closed. */
  onError: () => void
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Keeps a crashing app from leaving the player frozen: when a child throws,
 * `onError` sends `close` to Phaser and nothing is rendered in its place.
 * (Error boundaries can only be class components.)
 */
export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[WebTown] An in-house app crashed and was closed:', error, info)
    this.props.onError()
  }

  override render(): ReactNode {
    return this.state.hasError ? null : this.props.children
  }
}
