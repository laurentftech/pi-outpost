/**
 * The page Open WebUI embeds in the conversation when a planning or a structure is shown.
 *
 * Everything the page needs travels in it — the viewer's script and stylesheet, and
 * the planning — because the user's browser may have no route to this server; Open
 * WebUI's backend calls us, the browser only ever sees what Open WebUI stored. So the
 * page makes no request of its own.
 *
 * **The page holds no `&`.** Open WebUI (v0.11.4) stores a tool's embeds with
 * `JSON.stringify` but reads them back through an HTML-entity decoder before
 * `JSON.parse`. Any entity-looking text in the page — React's escaping table carries
 * `&quot;` and `&amp;` as literal strings, and a planning may well say "R&D" — is
 * decoded into a raw quote or ampersand inside the JSON, the parse fails, and the
 * embed silently never appears. So the stylesheet, the viewer and the planning travel
 * gzipped and base64-encoded, an alphabet with no `&`, and a few lines of bootstrap —
 * written without one — inflate them in the frame. Compression also keeps what every
 * chat stores small.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";

/** A document shown by show_structure. */
export interface EmbeddedStructure {
  mode: "structure";
  envelope: unknown;
}

export interface EmbeddedPlanning {
  mode?: "planning";
  id: string;
  title: string;
  revision: number;
  data: StructuredTimelineData;
  comparedWith?: number;
}

const VIEWER_DIR = new URL("../dist/viewer/", import.meta.url);

export interface ViewerAssets {
  script: string;
  style: string;
}

interface PackedAssets {
  script: string;
  style: string;
}

const packed = new WeakMap<ViewerAssets, PackedAssets>();
let cached: ViewerAssets | undefined;

/** The built viewer, read once. Missing means `npm run build:viewer` was not run. */
export function viewerAssets(): ViewerAssets {
  if (cached) return cached;
  const dir = fileURLToPath(VIEWER_DIR);
  const css = fs.readdirSync(dir).find((name) => name.endsWith(".css"));
  cached = {
    script: fs.readFileSync(fileURLToPath(new URL("viewer.js", VIEWER_DIR)), "utf8"),
    style: css ? fs.readFileSync(fileURLToPath(new URL(css, VIEWER_DIR)), "utf8") : "",
  };
  return cached;
}

/** gzip, then base64: what the bootstrap inflates. */
export function pack(text: string): string {
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 }).toString("base64");
}

function packedAssets(assets: ViewerAssets): PackedAssets {
  let entry = packed.get(assets);
  if (!entry) {
    entry = { script: pack(assets.script), style: pack(assets.style) };
    packed.set(assets, entry);
  }
  return entry;
}

/**
 * Inflates the three payloads and runs the viewer. Kept free of `&`, and of `<`
 * after the opening tag, so it survives the entity decoding and cannot end its own
 * script element. The viewer is run as an inline script, never through `eval`,
 * which a content security policy inherited by the frame could forbid.
 */
const BOOTSTRAP = `
(function () {
  function inflate(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i !== bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }
  var p = document.getElementById("payload").dataset;
  Promise.all([inflate(p.style), inflate(p.planning), inflate(p.script)]).then(function (parts) {
    var style = document.createElement("style");
    style.textContent = parts[0];
    document.head.appendChild(style);
    var data = document.createElement("script");
    data.type = "application/json";
    data.id = "planning";
    data.textContent = parts[1];
    document.body.appendChild(data);
    var viewer = document.createElement("script");
    viewer.textContent = parts[2];
    document.body.appendChild(viewer);
  }, function (error) {
    document.getElementById("root").textContent = "This could not be drawn: " + error;
  });
})();
`;

export function embedPage(payload: EmbeddedPlanning | EmbeddedStructure, assets: ViewerAssets = viewerAssets()): string {
  const { script, style } = packedAssets(assets);
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"></head><body>',
    '<div id="root"></div>',
    `<div id="payload" hidden data-style="${style}" data-script="${script}" data-planning="${pack(JSON.stringify(payload))}"></div>`,
    `<script>${BOOTSTRAP}</script>`,
    "</body></html>",
  ].join("");
}
