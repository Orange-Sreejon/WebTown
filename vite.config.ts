import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Force Vite to pre-bundle Phaser from its CJS entry so that
    // `import Phaser from 'phaser'` resolves to the namespace object.
    include: ['phaser'],
    esbuildOptions: {
      // Treat phaser as a CommonJS module so esbuild wraps it with a default export
      plugins: [],
    },
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})
