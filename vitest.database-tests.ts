/**
 * Test files that start a real PostgreSQL (PGlite, `TestDatabase.create()`). Each one costs seconds of CPU, so they run
 * as their own Vitest project, after the other tests rather than alongside them (see vitest.config.ts); running them
 * together made unrelated tests time out intermittently. `src/test-groups.test.ts` fails if a file that starts PGlite
 * is missing here, so a new database test can't silently land in the wrong group.
 */
export const DATABASE_TEST_FILES = [
  'src/cloud/cloud-repositories.test.ts',
  'src/cloud/database/canvas-schema.test.ts',
  'src/cloud/database/community-website-schema.test.ts',
  'src/cloud/database/multiplayer-schema.test.ts',
  'src/cloud/database/schema.test.ts',
  'src/cloud/local-import.test.ts',
  'src/community-canvas/session.test.ts',
  'src/components/community-moderation/ModerationPanel.test.tsx',
  'src/components/community-website/CommunityWebsiteApp.test.tsx',
  'src/components/multiplayer/worlds-gate.test.tsx',
] as const
