/**
 * The server's Mermaid renderer, shared by every Word tool call.
 *
 * Mermaid is drawn in a worker thread (`@pi-outpost/office`'s `mermaidRender.ts`), made
 * once, on the first diagram, and left idle in between: it does not keep the process
 * alive. Bundled — the npm package's `pi-outpost.mjs` and its tools extension — the
 * worker is `mermaid-worker.mjs` beside the bundle; run from source, it is the office
 * package's TypeScript module. The single-file executable has neither, and an install
 * may lack a native package it needs: there is then no renderer, and a Mermaid fence
 * is written as its source with a note, as before diagrams were drawn here.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMermaidRenderer, defaultMermaidWorkerUrl, mermaidUnavailable, type MermaidRenderer } from "@pi-outpost/office/mermaidRender.ts";

let shared: MermaidRenderer | null | undefined;

function workerUrl(): URL {
  try {
    const bundled = new URL("./mermaid-worker.mjs", import.meta.url);
    if (bundled.protocol === "file:" && existsSync(fileURLToPath(bundled))) return bundled;
  } catch {
    // An executable's own module URL may not be a file at all: fall through.
  }
  return defaultMermaidWorkerUrl();
}

/** The renderer, or `null` when this installation cannot draw Mermaid. */
export function serverMermaidRenderer(): MermaidRenderer | null {
  if (shared !== undefined) return shared;
  const url = workerUrl();
  shared = mermaidUnavailable(url) === undefined ? createMermaidRenderer({ workerUrl: url }) : null;
  return shared;
}
