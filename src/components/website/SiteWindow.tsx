import { WindowFrame } from '../apps/WindowFrame'
import { SiteBrowser, type SiteBrowserProps } from './SiteBrowser'

export { storageStatus, type RecoveryNotice } from './SiteBrowser'

interface SiteWindowProps extends Omit<SiteBrowserProps, 'actions' | 'notice'> {
  onClose: () => void
}

/**
 * The website window a visitor gets (and an owner who is only reading): the
 * window frame around a `SiteBrowser`. Closing it is the frame's Close button
 * or Escape; the host turns that into the `close` command.
 *
 * It receives a `SiteReader` and nothing else: there is no writer in this
 * window or below it, in either mode.
 */
export function SiteWindow({ onClose, ...browser }: SiteWindowProps): React.ReactElement {
  return (
    <WindowFrame title="WebTown Browser" onClose={onClose} size="wide">
      <SiteBrowser {...browser} />
    </WindowFrame>
  )
}
