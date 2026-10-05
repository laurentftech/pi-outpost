import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Inlines the built script and stylesheet into the page, so the view is one file.
 *
 * A dozen lines instead of a plugin dependency: vite-plugin-singlefile pulled in a
 * micromatch whose braces has an unfixed advisory, for work this small.
 */
function inlineIntoPage(): Plugin {
  return {
    name: "pi-outpost-inline-into-page",
    enforce: "post",
    generateBundle(_options, bundle) {
      const page = Object.values(bundle).find((output) => output.type === "asset" && output.fileName.endsWith(".html"));
      if (!page || page.type !== "asset") return;
      let html = String(page.source);
      for (const [fileName, output] of Object.entries(bundle)) {
        const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (output.type === "chunk") {
          // `</script` inside the code would end the element early.
          const code = output.code.replace(/<\/script/gi, "<\\/script");
          html = html.replace(new RegExp(`<script([^>]*) src="[^"]*${escaped}"[^>]*></script>`), (_match, attributes: string) => `<script${attributes.replace(/\s*crossorigin/, "")}>${code}</script>`);
          delete bundle[fileName];
        } else if (fileName.endsWith(".css")) {
          html = html.replace(new RegExp(`<link[^>]*href="[^"]*${escaped}"[^>]*>`), () => `<style>${String(output.source)}</style>`);
          delete bundle[fileName];
        }
      }
      page.source = html;
    },
  };
}

/**
 * One self-contained HTML page: React, the timeline, the MCP Apps client and the
 * stylesheet, inlined. The host serves it as the `ui://` resource and the page fetches
 * nothing, so it declares no CSP domains.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react(), tailwindcss(), inlineIntoPage()],
  // The ui/ sources sit outside this package; one React for them and for the app.
  resolve: { dedupe: ["react", "react-dom"] },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../dist/viewer",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    rollupOptions: { input: "planning.html", output: { inlineDynamicImports: true } },
  },
});
