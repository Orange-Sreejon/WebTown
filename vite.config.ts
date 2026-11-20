import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Force Vite to pre-bundle Phaser from its CJS entry so that
    // `import Phaser from 'phaser'` resolves to the namespace object.
    // The code editor is only in the owner's lazily loaded Site Studio. Pre-bundling it up front stops the dev
    // server from discovering it on first use and reloading the page mid-session.
    include: ['phaser', 'codemirror', '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/lang-html', '@codemirror/lang-css'],
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
