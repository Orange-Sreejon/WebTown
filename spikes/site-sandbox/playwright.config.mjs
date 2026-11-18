import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// One worker, in order: the beacon's log is shared, and each test resets it.
export default defineConfig({
  testDir: join(here, 'tests'),
  outputDir: join(here, 'test-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: join(here, 'test-results', 'results.json') }]],
  use: { baseURL: 'http://127.0.0.1:5199', trace: 'off' },
  webServer: {
    command: 'node spikes/site-sandbox/server.mjs',
    cwd: join(here, '..', '..'),
    url: 'http://127.0.0.1:8765/__health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
