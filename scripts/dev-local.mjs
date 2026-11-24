// One command for local accounts, invitations and two-player presence:
//
//   npm run dev:local
//
// Starts the Supabase stand-in (tests/multiplayer/emulator.mjs) and the Vite dev server with the app pointed at it.
// The stand-in is not Supabase: it runs the real migrations and policies on PGlite, in memory, so everything is
// reset when it stops. See docs/MULTIPLAYER.md. Ctrl+C stops both; if either one stops, the other does too.
//
// Overridable: EMULATOR_PORT (default 54399), APP_PORT (default 5181).
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EMULATOR_PORT = process.env.EMULATOR_PORT ?? '54399'
const APP_PORT = process.env.APP_PORT ?? '5181'
const EMULATOR = `http://127.0.0.1:${EMULATOR_PORT}`
const APP = `http://127.0.0.1:${APP_PORT}`

const children = new Map()
let stopping = false

function start(name, args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' })
  children.set(name, child)
  child.on('error', error => {
    console.error(`[dev:local] could not start ${name}: ${error.message}`)
    stop(1)
  })
  child.on('exit', (code, signal) => {
    children.delete(name)
    if (stopping) return
    console.error(`[dev:local] ${name} stopped (${signal ?? `exit ${code}`}); shutting down.`)
    stop(code === 0 || signal ? 0 : 1)
  })
}

/** Stop every child, wait for them to be gone, then exit with `code`. */
async function stop(code) {
  if (stopping) return
  stopping = true
  const exited = [...children.values()].map(
    child =>
      new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode) return resolve()
        child.once('exit', resolve)
        child.kill()
      }),
  )
  // A child that ignores the signal must not hang the shutdown.
  const kill = new Promise(resolve =>
    setTimeout(() => {
      for (const child of children.values()) child.kill('SIGKILL')
      resolve()
    }, 5000),
  )
  await Promise.race([Promise.all(exited), kill])
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))

async function ready(url) {
  const until = Date.now() + 60_000
  while (Date.now() < until) {
    try {
      const res = await fetch(url)
      if (res.ok && (await res.json()).ok === true) return true
    } catch {
      // Not listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

console.log(`[dev:local] starting the Supabase stand-in on ${EMULATOR}`)
start('the stand-in', ['tests/multiplayer/emulator.mjs'])

if (!(await ready(`${EMULATOR}/__test/health`))) {
  console.error(
    '[dev:local] the stand-in did not become ready. If its port is taken, stop the other instance or set EMULATOR_PORT.',
  )
  stop(1)
} else {
  console.log(`[dev:local] starting WebTown on ${APP} — open that URL in two different browsers`)
  start('WebTown', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', APP_PORT, '--strictPort'], {
    VITE_SUPABASE_URL: EMULATOR,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_emulator_test',
  })
}
