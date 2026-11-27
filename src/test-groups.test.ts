import { describe, expect, it } from 'vitest'
import { DATABASE_TEST_FILES } from '../vitest.database-tests'

/**
 * Every test file that starts a real PostgreSQL (PGlite) must be in the database group, which runs after the others
 * (vitest.config.ts). One that is not would run alongside everything else and make unrelated tests time out.
 */
const tests = import.meta.glob<string>(['/src/**/*.test.ts', '/src/**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

describe('test groups', () => {
  it('lists every test file that starts PGlite, and only those that exist', () => {
    const starting = Object.entries(tests)
      .filter(([path, text]) => !path.endsWith('/test-groups.test.ts') && /TestDatabase\.create\(\)/.test(text))
      .map(([path]) => path.slice(1))
      .sort()
    expect([...DATABASE_TEST_FILES].sort()).toEqual(starting)
  })
})
