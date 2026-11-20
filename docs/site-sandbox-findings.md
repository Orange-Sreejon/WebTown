# S-01 Sandbox spike: findings

Status: **complete, awaiting review.** S-02 does not start until this is reviewed (S-01 gate).

The spike is a small stand-in for WebTown (`spikes/site-sandbox/`), not Site Studio. It is not built, shipped or
part of `npm test`. Run it with `npm run spike:sandbox`.

## Result in one paragraph

The two-layer sandbox with **no resident JavaScript** held in all three engines. Two consecutive full runs passed
**173 of 173** tests, with 1 skip. The skip is WebKit's WebRTC control, because that build has no `RTCPeerConnection`.

Across all 15 static egress fixtures and every anchor, form and refresh route, **no request reached the beacon
server in any engine**. That covers images, CSS, fonts, media, frames, objects, preload links, meta refresh,
`<base>`, `ping`, anchors, forms and SVG.

No resident script ran, including scripts that guessed the host's nonce. The resident page could not reach WebTown's
DOM, storage or cookies, could not navigate the tab, and could not open popups or dialogs.

The spike also overturned two of my earlier design assumptions:
- **WebRTC is a real egress channel.** In Chromium, a script inside the opaque frame sent STUN datagrams despite
  `connect-src 'none'`.
- **A script infinite loop froze the WebTown page in all three engines.** Earlier in the design I wrote that Chrome
  isolates sandboxed frames in their own process; that did not happen in this setup.

Both make the SD-4 decision (no resident JavaScript in Phase 3a) load-bearing, not optional.

## Environment

| | |
|---|---|
| Machine | Windows, headless, single worker, sequential tests |
| Playwright | `@playwright/test` 1.65.1 |
| Chromium | Chrome for Testing 159.0.8154.6 |
| Firefox | Firefox 159.0 (Playwright build) |
| WebKit | WebKit 27.2 (Playwright build for Windows). **Not branded Safari**: results are WebKit-engine results and do not transfer to Safari automatically (for example, this build has no WebRTC). |
| Runs | Two consecutive full runs, identical pass/fail results |

## What was tested

### Structure

```
spike app (stand-in for WebTown)    http://127.0.0.1:5199    strict CSP of its own (img-src 'none', script-src 'self')
 └─ <iframe sandbox="allow-scripts" src="/site-host.html" referrerpolicy="no-referrer" allow="(22 features 'none')">
     host page: trusted, static, own CSP, bootstrap runs under nonce 'wtHost1'
     └─ <iframe sandbox="allow-scripts" srcdoc="(built page)" referrerpolicy="no-referrer" allow="(same)">
          resident page: inherits the host policy + its own CSP <meta> (script-src 'none')
Beacon (stands in for "the internet")  http://127.0.0.1:8765  + UDP 3478 (STUN)
```

### Policies, exactly as tested

Host page (`site-host.html`, static `<meta>`):
```
default-src 'none'; script-src 'nonce-wtHost1'; style-src 'unsafe-inline' data:; img-src data:; font-src data:;
media-src data:; connect-src 'none'; frame-src 'self'; child-src 'none'; worker-src 'none'; object-src 'none';
manifest-src 'none'; form-action 'none'; base-uri webtown-site:
```
plus, added by the host's bootstrap at start-up (it can only narrow): `frame-src <app origin>/site-nav.html`.

Resident page (inserted by the builder as the first child of `<head>`):
```
default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data:; img-src data:; font-src data:;
media-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none';
manifest-src 'none'; form-action 'none'; base-uri webtown-site:
```
followed by `<base href="webtown-site:/site/<path>">`.

Navigation page (`site-nav.html`, static `<meta>`): `default-src 'none'; script-src 'nonce-wtNav1'; base-uri 'none';
form-action 'none'`.

### Builder modes (to show which layer does what)

| Mode | What the resident frame gets |
|---|---|
| `product` | The design under test: sanitise, resident CSP `<meta>`, non-network `<base>`, links and assets rewritten |
| `raw-csp` | Resident CSP `<meta>` only, HTML otherwise untouched |
| `raw-none` | Nothing added: only the policy inherited from the host page |
| `diagnostic` | As `raw-none`, but the page's scripts are given the host's public nonce so they run. Used only to measure what an opaque frame could do if resident script ever ran. Never a product mode. |

### Evidence rules

- A claim that no request was made rests only on the beacon server's own log: every HTTP request, every UDP datagram,
  and TCP connections that never sent a request. Console errors and CSP violation reports were never used as evidence.
- An absence only counts where a **positive control** in the same engine showed that the beacon can see that kind of
  traffic. Without a working control, the claim is reported as unmeasured.
- "No script ran" means no trace at all: no `exec` message at the app, none reported by the host, and no `/exec/*`
  request at the beacon.

## Results

`✓` = passed (asserted), `rec` = recorded, not asserted.

### Controls

| Control | Chromium | Firefox | WebKit |
|---|---|---|---|
| Beacon sees an HTTP request from an unrestricted page | ✓ observed | ✓ observed | ✓ observed |
| Beacon sees WebRTC STUN (UDP) from an unrestricted page, loopback and LAN address | ✓ 4 and 4 datagrams | **not observed** (0 and 0) | **no `RTCPeerConnection`** |
| Beacon sees a bare TCP connection (`preconnect`) from an unrestricted page | **not observed** | **not observed** | **not observed** |

**UDP:** the Firefox control fails even without any sandbox, so this setup cannot show whether Firefox sends WebRTC
traffic from the frame. **Bare TCP:** no engine preconnected to the beacon at all, so the spike cannot prove anything
about `preconnect` or `dns-prefetch` from the network side. Those two are covered only by the builder removing such
links (and by no resident script running).

### Isolation and structure

| Check | Chromium | Firefox | WebKit |
|---|---|---|---|
| Both frames `sandbox="allow-scripts"`, never `allow-same-origin` | ✓ | ✓ | ✓ |
| Host frame origin (`self.origin`) | ✓ `null` | ✓ `null` | ✓ `null` |
| Resident frame origin | ✓ `null` | ✓ `null` | ✓ `null` |
| Host page opened directly (not framed) does nothing | ✓ | ✓ | ✓ |
| Diagnostic script reading `parent.document`, `top.document` | ✓ SecurityError | ✓ SecurityError | ✓ SecurityError |
| `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB` | ✓ SecurityError | ✓ SecurityError | ✓ SecurityError |
| WebTown's canaries (global, localStorage, cookie) unread and unchanged | ✓ | ✓ | ✓ |
| `top.location =`, `window.open`, `alert`, `confirm`, `print` | ✓ no navigation, popup or dialog | ✓ | ✓ |
| The WebTown app's own CSP is not inherited by the resident page (app has `img-src 'none'`, resident `data:` images render) | ✓ | ✓ | ✓ |

### Resident JavaScript does not run

Fixtures: inline, `defer`, `type="module"`, a site `.js` file, a remote script, event-handler attributes
(`onload`, `onclick`), `javascript:` links and frames, script inside an SVG file used as an image, and scripts carrying
the host's or the navigation page's nonce.

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| `product`: every fixture, including clicks | ✓ nothing ran | ✓ | ✓ |
| `product`: no `<script`, `nonce=` or `on*=` left in the rendered page | ✓ | ✓ | ✓ |
| `raw-csp` (resident policy only, no stripping), including the nonce guesses | ✓ nothing ran | ✓ | ✓ |
| `raw-none`, ordinary inline script (inherited host policy only) | rec: blocked | rec: blocked | rec: blocked |
| `raw-none`, script carrying the host's nonce | rec: **ran** | rec: **ran** | rec: **ran** |

The last row is the expected negative result, and it confirms the design reasoning. The host nonce is in a static
file, so it is not a secret: with only the inherited host policy, a resident page that copies it runs. Two
independent layers stop that, and each was shown to be enough on its own:
- the resident page's own `script-src 'none'`, shown by `raw-csp`;
- the builder removing scripts and `nonce` attributes, shown by `product`.

### Network egress (static, no script)

Fixtures: `<img>`, `srcset`, `<picture>`/`<source>`, `<input type=image>`, table `background`, CSS `background`,
`@import`, `@font-face`, `image-set()`, `cursor`, `list-style-image`, `content: url()`, `border-image`, `mask-image`,
`<audio>`, `<video>`, `<iframe>`, `<object>`, `<embed>`, `preload`/`prefetch`/`preconnect`/`dns-prefetch`, meta
refresh, resident `<base>` pointing at the beacon, SVG `<use>`/`<image>`, and an SVG file containing remote references
used as an image.

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| `product`: all 15 fixtures, no HTTP request, no UDP | ✓ | ✓ | ✓ |
| `raw-none` (inherited host policy only): 10 resource fixtures | ✓ nothing | ✓ | ✓ |
| `raw-csp` and `raw-none`: meta refresh, `ping`, prefetch links, `<base>` steal, `<img>`, `<iframe>` | rec: nothing | rec: nothing | rec: nothing |

So CSP **is** inherited from the host page into the nested `srcdoc` frame in all three engines (the `raw-none` row),
and the page builder is a second layer, not the only one.

### Clicks: anchors and forms

| Route | Chromium | Firefox | WebKit |
|---|---|---|---|
| Links to the beacon: plain, `target=_top`, `target=_blank`, `download`; `mailto:` | ✓ no request, no popup | ✓ | ✓ |
| Forms: GET, POST, `formaction` | ✓ no request | ✓ | ✓ |
| `<a ping>` | ✓ no request | ✓ | ✓ |

### Self-navigation of the resident frame

This was the residual risk I listed in design 16.9: CSP's `navigate-to` was dropped from the spec.

| Route | Chromium | Firefox | WebKit |
|---|---|---|---|
| Script sets `location.href` to the beacon (diagnostic) | rec: **no request**; no new load | rec: **no request**; no load event at all | rec: **no request**; no new load |
| Raw same-origin link to a WebTown page (`raw-none`) | ✓ no request at WebTown's server | ✓ | ✓ |
| Script sets `location` to a WebTown page (diagnostic) | ✓ no request | ✓ | ✓ |
| Link to WebTown's navigation page | ✓ loads | ✓ | ✓ |

The embedder's `frame-src` stops the resident frame's own navigations before a request is sent, in all three
engines. The host page's static `frame-src 'self'` was narrowed at start-up to exactly `/site-nav.html`. That
narrowing is honoured: WebTown's other pages are refused, and the navigation page is allowed.

**This closes the self-navigation residual for the tested engines.** The navigation-detection fallback in the host
(re-render after an unexpected load) never fired, because nothing got through to trigger it. It stays as a defence.
Firefox raises no `load` event for a blocked navigation, so a detector cannot rely on one.

### Script-driven network (diagnostic only)

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| `fetch`, XHR, `sendBeacon`, `WebSocket`, `EventSource` | ✓ nothing | ✓ nothing | ✓ nothing |
| `RTCPeerConnection` present in the resident frame | `function` | `function` | `undefined` |
| WebRTC STUN datagrams from the resident frame | rec: **5 and 5 sent** | rec: 0 (unmeasurable, control failed) | n/a |

**WebRTC escapes CSP in Chromium.** A script in the opaque, CSP-restricted frame sent STUN datagrams to an address it
chose. That is a real egress and tracking channel. In Phase 3a it is unreachable because no resident script runs. If
resident JavaScript is ever allowed, this must be solved first; candidates are a `webrtc 'block'` policy where
supported, or not exposing JavaScript at all.

### Messages

| Check | Chromium | Firefox | WebKit |
|---|---|---|---|
| A hostile sibling frame forges `nav`, `ready`, `render`, `close`, `enter-edit` at the app and at the host frame | ✓ all rejected as foreign; no navigation, no confirmation, no bus event, no injected page | ✓ | ✓ |
| The resident frame (diagnostic) forges the same | ✓ rejected; forged `ready` never accepted | ✓ | ✓ |
| 200 valid-looking navigation messages in one burst | ✓ 10 delivered, rest dropped and reported | ✓ 10 | ✓ 10 |
| A well-formed external-link request repeated by a page | ✓ at most 4 restores, then stops | ✓ 4 | ✓ 3 (page stopped first) |

Each layer accepts only the window it created (`event.source`), then checks the origin (`"null"` for the host), the
rate (host 10 per second, app 30 per second), and a closed schema. No handler forwards anything to the event bus.

### Links through WebTown's chrome

| Check | Chromium | Firefox | WebKit |
|---|---|---|---|
| Relative links, folders and `..` move between the site's pages; WebTown's history records them | ✓ | ✓ | ✓ |
| A link to a missing page shows WebTown's "page not found" | ✓ | ✓ | ✓ |
| An external `https:` link opens nothing until the player confirms in the app's bar; Cancel opens nothing | ✓ | ✓ | ✓ |
| After confirmation the new tab has `window.opener === null` | ✓ | ✓ | ✓ |
| `http:` and `javascript:` links do nothing | ✓ | ✓ | ✓ |
| Site images and CSS background images render as `data:` URLs | ✓ | ✓ | ✓ |

### Close and Stop responsiveness

Worst observed delay of a `setTimeout(0)` in the WebTown page while the resident page loads, over two runs:

| Page | Chromium | Firefox | WebKit |
|---|---|---|---|
| 1 MB HTML (25 916 elements), no animation | ≤ 104 ms; loads in about 2 s | ≤ 3 ms; about 2 s | ≤ 12 ms; about 2.4 s |
| 1 MB HTML, every element animated with a blur filter | **1.3–2.0 s**; loads in 8–12 s | ≤ 0.56 s; 3.7–6 s | ≤ 15 ms; 10–12 s |
| 2.7 MB HTML (60 000 elements, animated, more than twice the approved limit) | 1.4–1.8 s | ≤ 17 ms | **frozen > 6 s**; about 30 s to load |
| After Stop (frame removed), any of the above | ✓ ≤ 1 ms | ✓ ≤ 1 ms | ✓ ≤ 83 ms |
| A resident script looping forever (diagnostic only) | rec: **frozen** | rec: **frozen** | rec: **frozen** |

Stop always recovered. Pages within the approved 1 MB limit kept the app usable in every engine, though a
deliberately heavy animated page delays Chromium by up to about 2 seconds while it loads. An infinite loop in
resident script froze WebTown in every engine, including Chromium, so I withdraw the earlier claim that Chrome's
sandboxed-frame process isolation would protect against it. With no resident script in Phase 3a, this cannot happen.

## What this changes in the design

1. **SD-2 passes** for Phase 3a, with the policy above and **no resident JavaScript**.
2. **Host `frame-src` narrowing is part of the design**, not an option. It is what stops self-navigation and
   same-origin loads. A static policy can't name the deployment origin, so the host's bootstrap adds it; the spike
   shows all three engines honour it. In Phase 3b, the host's HTTP header can carry the exact path instead.
3. **The resident page's own `script-src 'none'` and the builder's script/nonce stripping are both required.** The
   host nonce is public by construction.
4. **The page budget should follow the text-file limit.** A rendered HTML page stays within the 1 MB text limit,
   which the spike shows keeps the app usable. The 25 MB *rendered* budget in design 16.4 is about embedded assets
   (base64), not DOM size, and stays separate.
5. **WebRTC and script freezes are the reasons Phase 3a runs no resident script.** Any future JavaScript mode needs
   its own spike: a WebRTC block, and true process isolation (a separate site in Phase 3b) before any public use.
6. **Detection by `load` events cannot be relied on** (Firefox fires none for a blocked navigation). It stays as a
   fallback; prevention by `frame-src` is the control.
7. **The navigation channel is a request channel.** Messages from the resident frame look like messages from the
   navigation page, so the app validates every one: page links must be site pages; external links must pass the URL
   policy and the player's confirmation. A forged request can at most show the confirmation bar.

## Residual risks and limits (to carry into the steering file and Help)

| Risk | Status in Phase 3a |
|---|---|
| WebRTC egress | Real in Chromium if script runs. Unreachable in 3a (no resident script). Firefox unmeasured here; WebKit build has none. |
| Freezing WebTown | A script loop freezes all three engines: unreachable in 3a. A heavy animated page within limits can delay Chromium by about 2 s while loading. Stop always recovers. |
| `preconnect` / `dns-prefetch` | Not measurable with this beacon (no engine preconnected even unrestricted). Removed by the builder; cannot be added without script. |
| Navigation-page requests | A rewritten link loads `site-nav.html` from WebTown's own server. It is WebTown's file, and the fragment (which page) is not sent to the server. |
| Engine coverage | Chromium, Firefox and Playwright's WebKit on Windows, headless. Branded Safari, mobile browsers and headed mode were not tested. |
| Browser bugs | The design layers sandbox, inherited CSP, resident CSP and builder stripping, so a single engine bug in one layer does not open everything; but it is not proof against all bugs. |
| Client-side ownership | Unchanged: Phase 3a owner checks can be bypassed with developer tools. The sandbox protects players from pages; it is not authorisation. |
| Links within a page (`#name`) | Found while building the Studio (W-09). A `srcdoc` document resolves `#name` against its parent's address (the host page), so the click becomes a navigation that `frame-src` blocks. WebTown writes these links as `about:srcdoc#name`: a same-document jump in Chromium and Firefox. **WebKit** still treats it as a navigation: it is blocked, the host puts the page back and WebTown says the page "tried to go somewhere else". No request is made in any engine. |

## Shipped (website-studio, W-06 to W-09)

The real host and navigation pages are `public/site-host.html` and `public/site-nav.html`: the spike's pages with
`base-uri 'none'` (no `<base>` in resident pages), the navigation page found next to the host page (so a Vite `base`
works), and the spike's test-only messages removed. `npm run test:e2e` runs the real app in all three engines:
a hostile page saved through the Studio (scripts, handlers, meta refresh, `<base>`, forms, frames, objects,
`@import`, fonts, `ping`, prefetch, `javascript:` links, declarative shadow DOM) sends nothing to the beacon and
cannot reach WebTown.

## Files

| File | Purpose |
|---|---|
| `spikes/site-sandbox/server.mjs` | Spike app server and the recording beacon (HTTP, TCP, UDP) |
| `spikes/site-sandbox/www/index.html`, `app.js` | Stand-in for WebTown: canaries, host frame, message checks, link confirmation |
| `spikes/site-sandbox/www/site-host.html` | Prototype trusted host page |
| `spikes/site-sandbox/www/site-nav.html` | Prototype trusted navigation page |
| `spikes/site-sandbox/www/builder.js` | Prototype page builder with the four modes |
| `spikes/site-sandbox/www/fixtures.js` | Hostile and ordinary resident sites |
| `spikes/site-sandbox/www/attacker.html` | Hostile sibling frame |
| `spikes/site-sandbox/tests/sandbox.spec.mjs` | 58 tests per engine (173 runs plus 1 skip) |
| `spikes/site-sandbox/playwright.config.mjs` | Chromium, Firefox, WebKit; one worker |

Raw measurements from both runs are kept locally in `spikes/site-sandbox/findings/` (git-ignored).
