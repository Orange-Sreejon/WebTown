import { ErrorBoundary } from '../components/ErrorBoundary'
import { GameContainer } from '../components/GameContainer'

export function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <GameContainer />
    </ErrorBoundary>
  )
}
