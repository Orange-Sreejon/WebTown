import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The account tests against a REAL Supabase project (Phase 4). Nothing runs unless WEBTOWN_LIVE=1 and the
// project's URL and publishable key are given; see docs/ACCOUNTS.md for the project settings they expect.
//
//   WEBTOWN_LIVE=1 WEBTOWN_LIVE_SUPABASE_URL=https://<ref>.supabase.co \
//   WEBTOWN_LIVE_SUPABASE_KEY=sb_publishable_... npm run test:live
//
// Use a test project, never production: the tests create guests and accounts. "Confirm email" must be OFF in
// that project so the upgrade can finish without an inbox.
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.mjs/,
  outputDir: join(here, 'test-results'),
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5190', trace: 'retain-on-failure' },
  webServer: process.env.WEBTOWN_LIVE === '1' ? {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5190 --strictPort',
    cwd: root,
    url: 'http://127.0.0.1:5190/',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: process.env.WEBTOWN_LIVE_SUPABASE_URL ?? '',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.WEBTOWN_LIVE_SUPABASE_KEY ?? '',
    },
  } : undefined,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
