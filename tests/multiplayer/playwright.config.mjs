import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const EMULATOR = 'http://127.0.0.1:54399'

// Two real players: the production app (Vite dev server, supabase-js) pointed at the local Supabase stand-in
// (emulator.mjs: real migrations and policies on PGlite). Each test drives two separate browser sessions: Chromium
// and Firefox, each with its own storage, so they are two different guests. Not Supabase itself: see tests/live.
export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.mjs/,
  outputDir: join(here, 'test-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Three game pages boot in software WebGL on one machine; each test gets up to 14 minutes.
  timeout: 840_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  // No step may hang silently: a stuck click or page load fails with a message.
  use: { baseURL: 'http://127.0.0.1:5181', trace: 'retain-on-failure', actionTimeout: 120_000, navigationTimeout: 120_000 },
  webServer: [
    {
      command: 'node tests/multiplayer/emulator.mjs',
      cwd: root,
      url: `${EMULATOR}/__test/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5181 --strictPort',
      cwd: root,
      url: 'http://127.0.0.1:5181/',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_SUPABASE_URL: EMULATOR, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_emulator_test' },
    },
  ],
  projects: [{ name: 'two-players' }],
})
