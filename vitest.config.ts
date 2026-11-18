import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Lets a test read a stylesheet's real text (website.css?raw) to check its layout rules.
    css: { include: [/website(-editor)?\.css/] },
  },
})
