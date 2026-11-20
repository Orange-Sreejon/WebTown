/**
 * Where WebTown's two static sandbox pages are served from (`public/`), and
 * the base the page builder points rewritten links at. Both follow Vite's
 * `base`, so the host page's `frame-src` and the builder's links always agree.
 */

/** WebTown's address without a trailing slash, for example `https://webtown.example` or `.../town`. */
export function siteAppBase(): string {
  return new URL(import.meta.env.BASE_URL, window.location.href).href.replace(/\/$/, '')
}

/** The host page the website frame loads. */
export const siteHostUrl = (): string => `${siteAppBase()}/site-host.html`
