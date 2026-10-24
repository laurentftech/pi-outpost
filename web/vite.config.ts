import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Dev backend port; override with PI_OUTPOST_PORT when the server runs elsewhere.
const port = process.env.PI_OUTPOST_PORT ?? '3141'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // The application, and the poster editor frame the file viewer hosts.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        posterEditor: fileURLToPath(new URL('./poster-editor.html', import.meta.url)),
      },
    },
  },
  server: {
    proxy: {
      '/ws': {
        target: `ws://127.0.0.1:${port}`,
        ws: true,
      },
      '/branding': `http://127.0.0.1:${port}`,
      '/health': `http://127.0.0.1:${port}`,
      '/files': `http://127.0.0.1:${port}`,
    },
  },
})
