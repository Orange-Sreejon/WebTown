import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

// The real WebTown app (Vite dev server) plus the beacon, in Chromium, Firefox and WebKit.
// One worker, in order: the beacon's log is shared and each test resets it.
// Playwright's WebKit is close to Safari's engine but is not branded Safari.
export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.mjs/,
  outputDir: join(here, 'test-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Generous: the game renders in the same page, and headless Chromium does that with software WebGL.
  timeout: 420_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5180', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180 --strictPort',
      cwd: root,
      url: 'http://127.0.0.1:5180/site-host.html',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'node tests/e2e/beacon.mjs',
      cwd: root,
      url: 'http://127.0.0.1:8766/__health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
