// TEST ONLY. A small stand-in for a Supabase project, so two real browsers running the production client
// (supabase-js) can play together on this machine. It is not Supabase; the same flows run against a real project
// in tests/live. What it provides, and how faithfully:
//
// - Database: PGlite with supabase/tests/supabase-shim.sql and every migration in supabase/migrations/, so every
//   RPC runs the real functions under the real roles, grants and RLS (as PostgREST does: one transaction, role
//   `authenticated`, the JWT claims in `request.jwt.claims`).
// - Auth (GoTrue): anonymous sign-in, refresh, get user, sign out; HS256 JWTs with a test secret.
// - Realtime: the Phoenix v2 WebSocket protocol as realtime-js speaks it (text frames, binary user broadcasts),
//   private channels authorised by running the real `realtime.messages` policies as the user (a probe row must be
//   visible for receive, insertable for send), presence (state, diffs, removal on disconnect), broadcast to the
//   other subscribers of the topic.
// - Test controls (`/__test/*`): drop a user's sockets (a network cut), refuse their reconnects for a while,
//   traffic counters, and health.
import { createServer } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { WebSocketServer } from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const PORT = Number(process.env.EMULATOR_PORT ?? 54399)
const SECRET = 'webtown-emulator-test-secret'

// ── Database ────────────────────────────────────────────────────────────────────────────────────────────────

const pg = await PGlite.create()
await pg.exec(readFileSync(join(root, 'supabase/tests/supabase-shim.sql'), 'utf8'))
for (const file of readdirSync(join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(root, 'supabase/migrations', file), 'utf8'))
}

/** One serial queue: PGlite runs one transaction at a time anyway; this keeps them from interleaving. */
let queue = Promise.resolve()
const serial = run => {
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

async function asUser(tx, userId) {
  const claims = { sub: userId, role: 'authenticated', is_anonymous: true, aud: 'authenticated' }
  await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
  await tx.exec('set local role authenticated')
}

function rpc(userId, fn, args) {
  if (!/^[a-z_]+$/.test(fn)) return Promise.reject(Object.assign(new Error('bad function'), { code: 'PGRST202' }))
  const names = Object.keys(args ?? {})
  for (const n of names) if (!/^p_[a-z_]+$/.test(n)) return Promise.reject(Object.assign(new Error('bad argument'), { code: 'PGRST202' }))
  const values = names.map(n => {
    const v = args[n]
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
  })
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as result`
  return serial(() => pg.transaction(async tx => {
    await asUser(tx, userId)
    return (await tx.query(sql, values)).rows[0]?.result ?? null
  }))
}

const ROLLBACK = Symbol('rollback')
async function probe(body) {
  let result = false
  try {
    await pg.transaction(async tx => {
      result = await body(tx)
      throw ROLLBACK
    })
  } catch (error) {
    if (error !== ROLLBACK) throw error
  }
  return result
}

/** Supabase Realtime's authorisation check for a private channel, with the real policies. */
function channelAccess(userId, topic, extension) {
  return serial(async () => {
    const read = await probe(async tx => {
      const { rows } = await tx.query('insert into realtime.messages (topic, extension) values ($1, $2) returning id', [topic, extension])
      await asUser(tx, userId)
      await tx.query("select set_config('realtime.topic', $1, true)", [topic])
      return (await tx.query('select 1 from realtime.messages where id = $1', [rows[0].id])).rows.length === 1
    })
    const write = await probe(async tx => {
      await asUser(tx, userId)
      await tx.query("select set_config('realtime.topic', $1, true)", [topic])
      try {
        await tx.query('insert into realtime.messages (topic, extension) values ($1, $2)', [topic, extension])
        return true
      } catch {
        return false
      }
    })
    return { read, write }
  })
}

// ── Auth ────────────────────────────────────────────────────────────────────────────────────────────────────

const b64url = buf => Buffer.from(buf).toString('base64url')
function sign(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
function verify(token) {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) return null
  const sig = createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url')
  if (sig !== parts[2]) return null
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
  return payload
}

const users = new Map() // id -> user
const refreshTokens = new Map() // token -> user id

function userJson(id) {
  const u = users.get(id)
  return {
    id, aud: 'authenticated', role: 'authenticated', email: '', phone: '', is_anonymous: true,
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] }, user_metadata: {}, identities: [],
    created_at: u.createdAt, updated_at: u.createdAt,
  }
}
function session(id) {
  const now = Math.floor(Date.now() / 1000)
  const refresh = randomUUID()
  refreshTokens.set(refresh, id)
  return {
    access_token: sign({ sub: id, role: 'authenticated', aud: 'authenticated', is_anonymous: true, iat: now, exp: now + 3600, session_id: randomUUID() }),
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(id),
  }
}

// ── Realtime ────────────────────────────────────────────────────────────────────────────────────────────────

/** topic -> Set of subscriptions { socket, joinRef, key, meta, ref, canWrite, canPresence, user } */
const topics = new Map()
const sockets = new Set()
const blockedUntil = new Map() // user id -> ms
const stats = { broadcasts: [], joins: [], refusals: [] }

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)) }
const presenceOf = sub => ({ [sub.key]: { metas: [{ phx_ref: sub.ref, ...sub.meta }] } })

function presenceDiff(topic, joins, leaves) {
  for (const s of topics.get(topic) ?? []) send(s.socket, [null, null, s.wireTopic, 'presence_diff', { joins, leaves }])
}

function leave(sub) {
  const set = topics.get(sub.topic)
  if (!set?.delete(sub)) return
  if (sub.meta) presenceDiff(sub.topic, {}, presenceOf(sub))
}

function decodeBinaryPush(buf) {
  // Kind 3 (user broadcast push): kind, joinRef, ref, topic, event, metadata lengths, encoding; then the strings.
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (view.getUint8(0) !== 3) return null
  const lens = [1, 2, 3, 4, 5].map(i => view.getUint8(i))
  const encoding = view.getUint8(6)
  let offset = 7
  const take = n => { const s = buf.subarray(offset, offset + n).toString('utf8'); offset += n; return s }
  const [joinRef, ref, topic, event] = [take(lens[0]), take(lens[1]), take(lens[2]), take(lens[3])]
  take(lens[4])
  const rest = buf.subarray(offset)
  const payload = encoding === 1 ? JSON.parse(rest.toString('utf8')) : null
  return { joinRef, ref, topic, event, payload }
}

function onBroadcast(ws, wireTopic, ref, event, payload, joinRef) {
  const topic = wireTopic.replace(/^realtime:/, '')
  const sub = [...(topics.get(topic) ?? [])].find(s => s.socket === ws)
  if (!sub || !sub.canWrite) {
    if (ref) send(ws, [joinRef ?? null, ref, wireTopic, 'phx_reply', { status: 'error', response: { reason: 'Unauthorized' } }])
    return
  }
  stats.broadcasts.push({ at: Date.now(), topic, user: sub.user, event })
  if (stats.broadcasts.length > 20000) stats.broadcasts.splice(0, 10000)
  for (const s of topics.get(topic) ?? []) {
    if (s === sub) continue
    send(s.socket, [null, null, s.wireTopic, 'broadcast', { type: 'broadcast', event, payload }])
  }
  if (ref) send(ws, [joinRef ?? null, ref, wireTopic, 'phx_reply', { status: 'ok', response: {} }])
}

async function onJoin(ws, [joinRef, ref, wireTopic, , payload]) {
  const topic = wireTopic.replace(/^realtime:/, '')
  const claims = verify(payload?.access_token)
  const reply = (status, response) => send(ws, [joinRef, ref, wireTopic, 'phx_reply', { status, response }])
  if (!claims) return reply('error', { reason: 'Unauthorized: invalid or missing access token' })
  if (payload?.config?.private !== true) return reply('error', { reason: 'Unauthorized: this emulator only serves private channels' })
  const broadcast = await channelAccess(claims.sub, topic, 'broadcast')
  const presence = await channelAccess(claims.sub, topic, 'presence')
  if (!broadcast.read) {
    stats.refusals.push({ at: Date.now(), topic, user: claims.sub })
    return reply('error', { reason: `Unauthorized: You do not have permissions to read from this Channel topic: ${topic}` })
  }
  // A rejoin replaces the earlier subscription of this socket.
  for (const s of [...(topics.get(topic) ?? [])]) if (s.socket === ws) leave(s)
  const sub = {
    socket: ws, joinRef, wireTopic, topic, user: claims.sub, key: payload?.config?.presence?.key || randomUUID(),
    meta: null, ref: null, canWrite: broadcast.write, canPresence: presence.write,
  }
  if (!topics.has(topic)) topics.set(topic, new Set())
  topics.get(topic).add(sub)
  stats.joins.push({ at: Date.now(), topic, user: claims.sub })
  reply('ok', {})
  const state = {}
  for (const s of topics.get(topic)) if (s.meta) Object.assign(state, presenceOf(s))
  send(ws, [joinRef, null, wireTopic, 'presence_state', state])
}

function onPresence(ws, [joinRef, ref, wireTopic, , payload]) {
  const topic = wireTopic.replace(/^realtime:/, '')
  const sub = [...(topics.get(topic) ?? [])].find(s => s.socket === ws)
  const reply = status => send(ws, [joinRef, ref, wireTopic, 'phx_reply', { status, response: {} }])
  if (!sub || !sub.canPresence) return reply('error')
  const old = sub.meta ? presenceOf(sub) : {}
  if (payload?.event === 'track') {
    sub.meta = payload.payload ?? {}
    sub.ref = randomUUID()
    presenceDiff(topic, presenceOf(sub), old)
  } else if (payload?.event === 'untrack') {
    sub.meta = null
    presenceDiff(topic, {}, old)
  }
  reply('ok')
}

const wss = new WebSocketServer({ noServer: true })
wss.on('connection', (ws, user) => {
  sockets.add(ws)
  ws.user = user
  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        const m = decodeBinaryPush(Buffer.isBuffer(data) ? data : Buffer.concat(data))
        if (m) onBroadcast(ws, m.topic, m.ref || null, m.event, m.payload, m.joinRef || null)
        return
      }
      const msg = JSON.parse(String(data))
      const [joinRef, ref, topic, event, payload] = msg
      if (topic === 'phoenix' && event === 'heartbeat') return send(ws, [null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }])
      if (event === 'phx_join') return void onJoin(ws, msg)
      if (event === 'phx_leave') {
        for (const s of [...(topics.get(topic.replace(/^realtime:/, '')) ?? [])]) if (s.socket === ws) leave(s)
        return send(ws, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }])
      }
      if (event === 'presence') return onPresence(ws, msg)
      if (event === 'broadcast') return onBroadcast(ws, topic, ref, payload?.event, payload?.payload, joinRef)
      if (event === 'access_token') return
    } catch (error) {
      console.error('[emulator] bad message', error)
    }
  })
  ws.on('close', () => {
    sockets.delete(ws)
    for (const set of topics.values()) for (const s of [...set]) if (s.socket === ws) leave(s)
  })
})

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────────────

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, x-retry-count',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
}
const json = (res, status, body) => {
  res.writeHead(status, { ...cors, 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const readBody = req => new Promise(resolve => {
  let s = ''
  req.on('data', c => { s += c })
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch { resolve({}) } })
})
const bearer = req => verify(String(req.headers.authorization ?? '').replace(/^Bearer /i, ''))

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  try {
    if (url.pathname === '/__test/health') return json(res, 200, { ok: true })
    if (url.pathname === '/__test/stats') return json(res, 200, stats)
    if (url.pathname === '/__test/reset-stats') { stats.broadcasts = []; stats.joins = []; stats.refusals = []; return json(res, 200, {}) }
    if (url.pathname === '/__test/subscribers') {
      const topic = url.searchParams.get('topic')
      return json(res, 200, [...(topics.get(topic) ?? [])].map(s => ({ user: s.user, key: s.key, meta: s.meta })))
    }
    if (url.pathname === '/__test/drop' && req.method === 'POST') {
      const { userId, blockMs = 0 } = await readBody(req)
      if (blockMs > 0) blockedUntil.set(userId, Date.now() + blockMs)
      let dropped = 0
      for (const ws of [...sockets]) if (ws.user === userId) { ws.terminate(); dropped++ }
      return json(res, 200, { dropped })
    }

    if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
      const body = await readBody(req)
      if (body.email || body.phone) return json(res, 422, { code: 'email_provider_disabled', msg: 'The emulator only supports guests.' })
      const id = randomUUID()
      await serial(() => pg.query('insert into auth.users (id, is_anonymous) values ($1, true)', [id]))
      users.set(id, { createdAt: new Date().toISOString() })
      return json(res, 200, session(id))
    }
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const body = await readBody(req)
      const id = refreshTokens.get(body.refresh_token)
      if (url.searchParams.get('grant_type') !== 'refresh_token' || !id) return json(res, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
      refreshTokens.delete(body.refresh_token)
      return json(res, 200, session(id))
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      const claims = bearer(req)
      if (!claims || !users.has(claims.sub)) return json(res, 401, { code: 'bad_jwt', msg: 'invalid JWT' })
      return json(res, 200, userJson(claims.sub))
    }
    if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end() }

    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)
    if (rpcMatch && req.method === 'POST') {
      const claims = bearer(req)
      if (!claims) return json(res, 401, { code: '42501', message: 'permission denied', details: null, hint: null })
      const args = await readBody(req)
      try {
        return json(res, 200, await rpc(claims.sub, rpcMatch[1], args))
      } catch (error) {
        const code = error?.code ?? 'XX000'
        return json(res, code === '42501' ? 403 : 400, { code, message: error?.message ?? String(error), details: null, hint: null })
      }
    }
    json(res, 404, { message: `the emulator has no ${req.method} ${url.pathname}` })
  } catch (error) {
    console.error('[emulator]', error)
    json(res, 500, { message: String(error) })
  }
})

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname !== '/realtime/v1/websocket') return socket.destroy()
  // The token arrives with phx_join; the socket itself only carries the publishable key. To simulate a network
  // cut, a blocked user's reconnects are refused: realtime-js sends no user id here, so the block is checked on
  // the first join instead (see wrap below).
  wss.handleUpgrade(req, socket, head, ws => {
    const original = ws.emit.bind(ws)
    let user = null
    ws.emit = (event, ...args) => {
      if (event === 'message' && !user && !args[1]) {
        try {
          const msg = JSON.parse(String(args[0]))
          if (msg[3] === 'phx_join') {
            const claims = verify(msg[4]?.access_token)
            if (claims) {
              user = claims.sub
              ws.user = user
              const until = blockedUntil.get(user) ?? 0
              if (Date.now() < until) {
                ws.terminate()
                return true
              }
            }
          }
        } catch {
          // Not JSON: handled below.
        }
      }
      return original(event, ...args)
    }
    wss.emit('connection', ws, null)
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`[emulator] Supabase stand-in on http://127.0.0.1:${PORT}`))
