# S-01 sandbox spike (throwaway)

A small stand-in for WebTown that tests the two-layer sandbox for resident websites in Chromium, Firefox and WebKit.
It is **not** Site Studio, is not built or shipped, and is not part of `npm test`.

Results and conclusions: [`docs/site-sandbox-findings.md`](../../docs/site-sandbox-findings.md).

```
npm run spike:sandbox                      # all three engines, about 10 minutes
npx playwright test -c spikes/site-sandbox/playwright.config.mjs --project=firefox
```

Needs the Playwright browsers once: `npx playwright install chromium firefox webkit` (installed in the user's cache,
not in the repository).

| Path | What it is |
|---|---|
| `server.mjs` | App server (`http://127.0.0.1:5199`) and a separate recording beacon (`http://127.0.0.1:8765`, UDP 3478) |
| `www/` | Stand-in app, trusted host and navigation pages, prototype builder, fixtures, hostile sibling frame |
| `tests/sandbox.spec.mjs` | The security tests. Evidence is the beacon's log, never console output |
| `findings/` | Raw measurements written by the tests (git-ignored) |

The prototype builder and pages are deliberately small. S-04 and S-06 write the real ones, under the policies this
spike verified, and move the security suite onto them.
