import { useCallback, useEffect, useState } from 'react'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import type { WebsiteState } from '../../personal-spaces/site-project-storage/resolve-website'

export type WebsiteLoad =
  | { status: 'loading' }
  | { status: 'ready'; website: WebsiteState }
  | { status: 'error'; message: string }

/**
 * Loads a house's website through `open` (a read-only function handed down by
 * the app host) and reloads on demand. A stale answer is ignored.
 */
export function useWebsiteState(open: () => Promise<WebsiteState>): { load: WebsiteLoad; reload: () => void } {
  const [load, setLoad] = useState<WebsiteLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setLoad({ status: 'loading' })
    open().then(
      website => {
        if (current) setLoad({ status: 'ready', website })
      },
      (error: unknown) => {
        if (!current) return
        console.error('[WebTown] The website could not be loaded.', error)
        setLoad({
          status: 'error',
          message: error instanceof PersonalSpacesError ? error.message : 'Something went wrong while opening this website.',
        })
      },
    )
    return () => {
      current = false
    }
  }, [open, attempt])

  const reload = useCallback(() => setAttempt(n => n + 1), [])
  return { load, reload }
}
