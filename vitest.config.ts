import { defineConfig } from 'vitest/config'
import { DATABASE_TEST_FILES } from './vitest.database-tests'

const shared = {
  environment: 'jsdom',
  globals: true,
  // Lets a test read a stylesheet's real text (website.css?raw) to check its layout rules.
  css: { include: [/website(-studio)?\.css/] },
} as const

export default defineConfig({
  test: {
    // Two groups: everything else first, then the tests that start a real PostgreSQL (PGlite). Each PGlite costs
    // seconds of CPU; running them alongside the rest made unrelated tests time out (vitest.database-tests.ts).
    projects: [
      {
        extends: true,
        test: { ...shared, name: 'unit', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], exclude: [...DATABASE_TEST_FILES], sequence: { groupOrder: 0 } },
      },
      {
        extends: true,
        test: { ...shared, name: 'database', include: [...DATABASE_TEST_FILES], sequence: { groupOrder: 1 } },
      },
    ],
  },
})
