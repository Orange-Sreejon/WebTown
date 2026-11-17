import type { ReactNode } from 'react'
import { displayHost } from '../../personal-spaces/website/site-format'
import { validateExternalUrl } from '../../personal-spaces/website/url-policy'

interface ExternalLinkProps {
  /** The address as stored. It is checked again here. */
  url: string
  /** What the link says. Shown as text. */
  children: ReactNode
}

/**
 * A link to another website.
 *
 * It is an anchor only if the address passes the URL policy (https, a public
 * host name, no credentials). Then it opens in a new tab with
 * `rel="noopener noreferrer"`, so the other site gets no handle on this one
 * and is not told where the visitor came from, and it shows the host so the
 * visitor can see where it goes. An address that fails the policy is shown as
 * plain text with a note, never as a link. The browser's address is never
 * built from anything but the policy's own normalised result.
 */
export function ExternalLink({ url, children }: ExternalLinkProps): React.ReactElement {
  const check = validateExternalUrl(url)

  if (!check.ok) {
    return (
      <span className="wt-link-unavailable">
        {children}
        <span className="wt-note"> (link unavailable)</span>
      </span>
    )
  }

  return (
    <a href={check.href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="wt-host"> ({displayHost(check.href)})</span>
      <span className="wt-sr-only"> opens in a new tab</span>
    </a>
  )
}
