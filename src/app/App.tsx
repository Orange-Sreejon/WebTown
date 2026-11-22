import { ErrorBoundary } from '../components/ErrorBoundary'
import { GameContainer } from '../components/GameContainer'
import { SessionGate } from '../components/account/SessionGate'
import { readCloudConfig } from '../cloud/config'
import { deviceSources } from '../cloud/local-import'

/**
 * Supabase when the build is configured for it (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`);
 * otherwise WebTown runs on this device only, as before Phase 4.
 */
async function connect() {
  const result = readCloudConfig(import.meta.env as unknown as Record<string, unknown>)
  if (!result.ok) {
    if (result.reason !== 'not configured') console.error(`[WebTown] Supabase is not usable: ${result.reason}`)
    return null
  }
  // Loaded only when a backend is configured.
  const { connectSupabase } = await import('../cloud/supabase-backend')
  return connectSupabase(result.config)
}

const REDIRECT_TO = new URL(import.meta.env.BASE_URL, window.location.origin).href

export function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <SessionGate connect={connect} deviceSources={deviceSources} redirectTo={REDIRECT_TO}>
        <GameContainer />
      </SessionGate>
    </ErrorBoundary>
  )
}