import { defineConfig } from "vite";
import { inlineIntoPage } from "./vite.config.ts";

/**
 * The poster editor (probe) as one self-contained HTML page: GrapesJS, its stylesheet and
 * the MCP Apps client, inlined. The page fetches nothing, so it declares no CSP domains.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [inlineIntoPage()],
  build: {
    outDir: "../dist/viewer-poster",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    target: "es2022",
    rollupOptions: { input: "poster.html", output: { inlineDynamicImports: true } },
  },
});
