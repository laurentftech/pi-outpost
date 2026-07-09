import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3141',
        ws: true,
      },
      '/branding': 'http://127.0.0.1:3141',
      '/health': 'http://127.0.0.1:3141',
    },
  },
})
