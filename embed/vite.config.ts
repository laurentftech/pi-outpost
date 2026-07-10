import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Library build: mount(container, options) — bundles everything (Tailwind CSS
// inlined at runtime, shared protocol types, markdown/mermaid/highlight.js) except
// React, which the host app supplies as a peer dependency.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({ tsconfigPath: './tsconfig.app.json', include: ['src'], bundleTypes: true }),
  ],
  build: {
    lib: {
      entry: 'src/mount.tsx',
      name: 'PiOutpostEmbed',
      fileName: 'pi-outpost-embed',
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    },
  },
})
