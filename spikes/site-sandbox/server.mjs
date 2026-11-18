// S-01 sandbox spike: two servers in one process. Throwaway; not shipped.
//
//  - APP     http://127.0.0.1:5199   serves ./www (the spike "WebTown" page, host page, nav page)
//            and records any request for a file it was not expecting.
//  - BEACON  http://127.0.0.1:8765   a different origin standing in for "the internet". It records
//            every HTTP request, every TCP connection that never sends a request (preconnect),
//            and every UDP datagram on 3478 (WebRTC STUN). Control endpoints start with /__.
//
// The tests read the beacon's log to prove whether a request really left the page. Console
// errors and CSP reports are not trusted as evidence.
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'www')
const APP_PORT = 5199
const BEACON_PORT = 8765
const STUN_PORT = 3478

const log = { http: [], bare: [], udp: [], unexpectedApp: [] }
// Every TCP connection to the beacon. A connection counts as bare (for example a preconnect) once it is
// 400 ms old without having sent a request, whether or not it has been closed yet.
let conns = []
const reset = () => { log.http = []; log.bare = []; log.udp = []; log.unexpectedApp = []; conns = [] }
const snapshot = () => ({ ...log, bare: conns.filter(c => !c.sawRequest && !c.control && Date.now() - c.at > 400).map(c => ({ at: c.at })) })

// Files the spike app is allowed to load. Anything else reaching the app server is a finding.
const EXPECTED_APP = new Set([
  '/', '/index.html', '/app.js', '/builder.js', '/fixtures.js', '/site-host.html', '/site-nav.html',
  '/attacker.html', '/favicon.ico',
])
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

const app = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (!EXPECTED_APP.has(path)) log.unexpectedApp.push({ path, at: Date.now(), dest: req.headers['sec-fetch-dest'] ?? null })
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return }
  const file = normalize(join(ROOT, path === '/' ? 'index.html' : path))
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})

const beacon = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.socket.__conn) req.socket.__conn.sawRequest = true
  if (url.pathname.startsWith('/__')) {
    if (req.socket.__conn) req.socket.__conn.control = true
    if (url.pathname === '/__reset') { reset(); res.end('ok'); return }
    if (url.pathname === '/__health') { res.end('ok'); return }
    if (url.pathname === '/__log') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(snapshot()))
      return
    }
  }
  log.http.push({ method: req.method, path: url.pathname, at: Date.now(), upgrade: req.headers.upgrade ?? null,
    dest: req.headers['sec-fetch-dest'] ?? null, referer: req.headers.referer ?? null })
  // Something plausible for every kind of resource, so a request that does arrive is not
  // rejected for a dull reason before a browser would act on it.
  const body = url.pathname.startsWith('/exec/')
    ? "for (const w of [parent, parent.parent, top]) { try { w.postMessage({ t: 'exec', id: 'beacon-script' }, '*') } catch (e) {} }"
    : 'ok'
  res.writeHead(200, { 'content-type': url.pathname.startsWith('/exec/') ? 'text/javascript' : 'text/plain',
    'access-control-allow-origin': '*' })
  res.end(body)
})
beacon.on('upgrade', (req, socket) => {
  log.http.push({ method: req.method, path: req.url, at: Date.now(), upgrade: req.headers.upgrade ?? 'unknown' })
  socket.destroy()
})
beacon.on('connection', socket => {
  const conn = { at: Date.now(), sawRequest: false, control: false }
  socket.__conn = conn
  conns.push(conn)
})

const stun = createSocket('udp4')
stun.on('message', (msg, rinfo) => log.udp.push({ bytes: msg.length, from: `${rinfo.address}:${rinfo.port}`, at: Date.now() }))

app.listen(APP_PORT, '127.0.0.1', () => console.log(`spike app     http://127.0.0.1:${APP_PORT}`))
beacon.listen(BEACON_PORT, '127.0.0.1', () => console.log(`spike beacon  http://127.0.0.1:${BEACON_PORT}`))
stun.bind(STUN_PORT, '0.0.0.0', () => console.log(`spike stun    udp://0.0.0.0:${STUN_PORT}`))
