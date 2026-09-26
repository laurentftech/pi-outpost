#!/usr/bin/env node
/**
 * Guard the exports' chunk boundary.
 *
 * The export carries a document writer, KaTeX and mermaid behind it — 645 kB of
 * JavaScript, 187 kB over the wire. That is acceptable only because nobody
 * downloads it until they press the button: `FileViewer` reaches the export
 * through `import()` inside its click handler, exactly as the workbook export
 * does.
 *
 * That boundary is one static import away from disappearing, and nothing else
 * would notice. Every test would stay green, the build would succeed, and the
 * only symptom would be a slower first paint for every reader — including those
 * who never export anything. Bundle composition is invisible to typecheck, lint
 * and jsdom alike, so it is checked here, against the built artifact.
 *
 * The conversation export is held to the same rule and checked the same way: it carries
 * the markdown pipeline, KaTeX and mermaid, and `App` reaches it through `import()` in
 * the export button's handler.
 *
 * Run after `npm run build --workspace web`.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(ROOT, "web/dist/assets");

/**
 * Strings that can only come from the document writer.
 *
 * Chosen to survive minification: they are string literals in the emitted XML, not
 * identifiers a minifier is free to rename.
 */
const WRITER_MARKERS = ["w:tblHeader", "oMath", "Content_Types"];

/**
 * Strings that can only come from the conversation export's own document.
 *
 * Sentences the document writes into itself, kept verbatim by a minifier because they
 * are string literals. Deliberately not `prefers-color-scheme`, which the application's
 * own theme handling also contains — a marker the entry chunk holds anyway would fail
 * this check for a boundary that is intact.
 */
const CONVERSATION_MARKERS = ["it needs no network and no scripting", "conversation compacted here"];

/** What the gzipped chunk may weigh before someone should look at it again. */
const CHUNK_BUDGET_BYTES = 260_000;

async function main() {
  let files;
  try {
    files = await readdir(ASSETS);
  } catch {
    console.error(`No build output at ${ASSETS}. Run: npm run build --workspace web`);
    process.exit(1);
  }

  const entry = files.find((name) => /^index-.*\.js$/.test(name));
  const exportChunk = files.find((name) => /^docxExport-.*\.js$/.test(name));
  const problems = [];

  if (entry === undefined) {
    problems.push("no index-*.js entry chunk in the build output");
  }
  if (exportChunk === undefined) {
    problems.push("no docxExport-*.js chunk — the export is no longer split out of the main bundle");
  }

  const conversationChunk = files.find((name) => /^conversationExport-.*\.js$/.test(name));
  if (conversationChunk === undefined) {
    problems.push(
      "no conversationExport-*.js chunk — the conversation export is no longer split out of the main bundle",
    );
  }

  if (entry !== undefined) {
    const source = await readFile(path.join(ASSETS, entry), "utf8");
    for (const marker of [...WRITER_MARKERS, ...CONVERSATION_MARKERS]) {
      if (source.includes(marker)) {
        problems.push(
          `the entry chunk ${entry} contains "${marker}" — the export has been pulled into the main bundle, ` +
            "probably by a static import of ui/src/export/*. Reach it with await import() instead.",
        );
      }
    }
  }

  if (exportChunk !== undefined) {
    const bytes = (await readFile(path.join(ASSETS, exportChunk))).byteLength;
    // The marker has to be *somewhere*, or these checks are passing for free.
    const source = await readFile(path.join(ASSETS, exportChunk), "utf8");
    if (!WRITER_MARKERS.some((marker) => source.includes(marker))) {
      problems.push(
        `${exportChunk} contains none of the writer's markers — either the markers are stale ` +
          "or the export chunk no longer holds the writer, which would make this check vacuous.",
      );
    }
    if (bytes > CHUNK_BUDGET_BYTES * 4) {
      problems.push(`${exportChunk} is ${bytes} bytes, well past what was budgeted; check what has been added to it`);
    }
    console.log(`export chunk: ${exportChunk} (${bytes} bytes uncompressed)`);
  }

  if (conversationChunk !== undefined) {
    const source = await readFile(path.join(ASSETS, conversationChunk), "utf8");
    if (!CONVERSATION_MARKERS.some((marker) => source.includes(marker))) {
      problems.push(
        `${conversationChunk} contains none of the conversation document's markers — either the markers ` +
          "are stale or the document is no longer built there, which would make this check vacuous.",
      );
    }
    const bytes = (await readFile(path.join(ASSETS, conversationChunk))).byteLength;
    console.log(`conversation export chunk: ${conversationChunk} (${bytes} bytes uncompressed)`);
  }

  if (problems.length > 0) {
    console.error("Export chunk check failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("Export chunk check passed: both exports are out of the main bundle.");
}

await main();
