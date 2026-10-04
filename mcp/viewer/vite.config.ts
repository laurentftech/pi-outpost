import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * One self-contained HTML page: React, the timeline, the MCP Apps client and the
 * stylesheet, inlined. The host serves it as the `ui://` resource and the page fetches
 * nothing, so it declares no CSP domains.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // The ui/ sources sit outside this package; one React for them and for the app.
  resolve: { dedupe: ["react", "react-dom"] },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../dist/viewer",
    emptyOutDir: true,
    rollupOptions: { input: "planning.html" },
  },
});
