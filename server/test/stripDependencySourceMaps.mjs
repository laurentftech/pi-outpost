/**
 * Keeps dependencies' source maps out of the coverage run's V8 coverage files.
 *
 * Loaded by `test:coverage` after tsx: `node --import tsx/esm --import ./test/stripDependencySourceMaps.mjs`.
 *
 * With NODE_V8_COVERAGE set, node stores the source map of every module it loads inside
 * that process's coverage file. For our TypeScript that is the point — tsx's maps are what
 * the report reads lines through. For dependencies it is dead weight the report never
 * shows, and it is heavy: pdf.js alone put ~8 MiB into the coverage file of every test
 * process that loads it. tsx rewrites its dynamic `import()` calls and inlines a
 * word-by-word map for that, and pdf.js ships its own `.map` files besides. Node writes a
 * coverage file in a single write at exit and the reporter parses every one, so files
 * that size are where the run failed with "failed to parse coverage file … Unterminated
 * string in JSON", cut at 10 MiB, while every test passed.
 *
 * So after tsx has loaded a module under node_modules, every `sourceMappingURL` comment is
 * removed from it — tsx's inline one and the package's own, which node would otherwise fall
 * back to. Nothing under node_modules is in the coverage report; nothing else is touched.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";

const MAP_COMMENT = /^\/\/[#@] sourceMappingURL=.*$/gm;

/** The source node should store for `url`: without map comments when it is a dependency. */
export function withoutDependencySourceMaps(url, source) {
  if (!url.includes("/node_modules/") || !source.includes("sourceMappingURL=")) return source;
  return source.replace(MAP_COMMENT, "");
}

/**
 * In a coverage run, where the code V8 ran for our own sources is kept: the JavaScript tsx
 * produced, which the coverage file's byte ranges refer to and the converter must parse —
 * the `.ts` on disk is not that code. One file per distinct source, under `sources/`.
 */
const SOURCES = process.env.NODE_V8_COVERAGE ? path.join(process.env.NODE_V8_COVERAGE, "sources") : undefined;
const OWN = /\/(?:server|shared)\/src\//;

function recordSource(url, source) {
  if (!SOURCES || !url.startsWith("file:") || url.includes("/node_modules/") || !OWN.test(url)) return;
  const name = `${createHash("sha1").update(url).update("\0").update(source).digest("hex")}.json`;
  const file = path.join(SOURCES, name);
  if (existsSync(file)) return;
  mkdirSync(SOURCES, { recursive: true });
  writeFileSync(file, JSON.stringify({ url, source }));
}

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (result.source != null && !url.includes("/node_modules/")) {
      recordSource(url, typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8"));
    }
    if (result.source == null || !url.includes("/node_modules/")) return result;
    const source = typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
    const stripped = withoutDependencySourceMaps(url, source);
    return stripped === source ? result : { ...result, source: stripped };
  },
});
