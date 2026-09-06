import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/D:/..." with a
// leading slash, which is not a path any filesystem call accepts.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the host page the embed smoke test loads.
 *
 * No Tailwind plugin here on purpose: the widget carries its own stylesheet
 * inlined in the bundle, and a host page that happened to build the same
 * utilities would make the isolation assertions meaningless — they would pass
 * whether or not the Shadow DOM did anything.
 */
export default defineConfig({
  root: path.join(HERE, "host"),
  plugins: [react()],
  build: {
    outDir: path.join(HERE, "dist-host"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // The embed host page, and beside it a harness that runs the Word export
        // in a real browser — the only place a diagram can actually be drawn and
        // rasterised, which jsdom cannot do.
        index: path.join(HERE, "host/index.html"),
        export: path.join(HERE, "host/export.html"),
      },
    },
  },
});
