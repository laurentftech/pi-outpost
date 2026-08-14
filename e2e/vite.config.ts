import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Builds the host page the embed smoke test loads.
 *
 * No Tailwind plugin here on purpose: the widget carries its own stylesheet
 * inlined in the bundle, and a host page that happened to build the same
 * utilities would make the isolation assertions meaningless — they would pass
 * whether or not the Shadow DOM did anything.
 */
export default defineConfig({
  root: new URL("./host", import.meta.url).pathname,
  plugins: [react()],
  build: {
    outDir: new URL("./dist-host", import.meta.url).pathname,
    emptyOutDir: true,
  },
});
