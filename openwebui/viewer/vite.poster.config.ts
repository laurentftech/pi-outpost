import { defineConfig } from "vite";

/**
 * The poster editor as one self-contained script and stylesheet, inlined by the server
 * into each poster embed — a bundle of its own, so a planning's embed does not carry
 * GrapesJS.
 */
export default defineConfig({
  root: import.meta.dirname,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../dist/viewer-poster",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: "poster.ts",
      name: "PosterViewer",
      formats: ["iife"],
      fileName: () => "poster.js",
    },
  },
});
