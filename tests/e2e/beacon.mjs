// Browser-test beacon: a server on another origin standing in for "the internet". It records every
// HTTP request and every TCP connection that never sends one (a preconnect). The website tests read
// its log to prove whether anything left a resident's page. Control endpoints start with /__.
// Test tooling only; never shipped.
import { createServer } from 'node:http'

export const BEACON_PORT = 8766
let http = []
let conns = []

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.socket.__conn) req.socket.__conn.sawRequest = true
  if (url.pathname.startsWith('/__')) {
    if (req.socket.__conn) req.socket.__conn.control = true
    res.setHeader('access-control-allow-origin', '*')
    if (url.pathname === '/__reset') { http = []; conns = []; res.end('ok'); return }
    if (url.pathname === '/__health') { res.end('ok'); return }
    if (url.pathname === '/__log') {
      const bare = conns.filter(c => !c.sawRequest && !c.control && Date.now() - c.at > 400).map(c => ({ at: c.at }))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ http, bare }))
      return
    }
  }
  http.push({ method: req.method, path: url.pathname, dest: req.headers['sec-fetch-dest'] ?? null, at: Date.now() })
  res.writeHead(200, { 'content-type': 'image/gif', 'access-control-allow-origin': '*' })
  res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))
})
server.on('connection', socket => {
  const conn = { at: Date.now(), sawRequest: false, control: false }
  socket.__conn = conn
  conns.push(conn)
})
server.listen(BEACON_PORT, '127.0.0.1', () => console.log(`beacon on ${BEACON_PORT}`))
