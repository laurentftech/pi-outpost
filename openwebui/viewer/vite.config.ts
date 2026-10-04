import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * One self-contained script: React, the timeline and its stylesheet, nothing loaded
 * at run time. The server inlines it into every embed, because the user's browser may
 * not be able to reach the server at all (see the change's prototype notes).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../dist/viewer",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: "main.tsx",
      name: "PlanningViewer",
      formats: ["iife"],
      fileName: () => "viewer.js",
    },
  },
});
