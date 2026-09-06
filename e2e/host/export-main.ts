/**
 * The Word export, reachable from a browser test.
 *
 * Imported from source rather than through a package entry point: what is under
 * test is this repository's conversion code, and the export is deliberately not
 * part of the widget's published surface.
 *
 * The bytes cross into the test as base64 because Playwright's `evaluate` returns
 * JSON — a `Uint8Array` would arrive as an object with numeric keys, and a `Blob`
 * would not arrive at all.
 */
import { buildDocx } from "../../ui/src/export/docxExport";

declare global {
  interface Window {
    __docxExport: {
      build(markdown: string, path: string): Promise<string>;
      /** How long one export took, so a test can assert the page stayed usable. */
      lastDurationMs: number;
    };
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks: a spread of a few hundred thousand arguments overflows the stack,
  // which for a document with an embedded diagram is an ordinary size.
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

window.__docxExport = {
  lastDurationMs: 0,
  async build(markdown: string, path: string): Promise<string> {
    const started = performance.now();
    const blob = await buildDocx(markdown, path);
    window.__docxExport.lastDurationMs = performance.now() - started;
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
  },
};

document.getElementById("ready")!.textContent = "harness ready";
