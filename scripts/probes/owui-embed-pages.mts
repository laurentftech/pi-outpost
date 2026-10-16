/**
 * Writes Open WebUI embed pages for a few conformance documents, to look at them in a
 * browser as Open WebUI frames them (srcdoc, sandbox without same-origin).
 * Usage: npx tsx scripts/probes/owui-embed-pages.mts <out-dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { embedPage } from "../../openwebui/src/embed.ts";
import { judgeStructure } from "../../openwebui/src/structure.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: owui-embed-pages.mts <out-dir>");
const frames: string[] = [];
for (const name of ["graph-with-typed-relationship.json", "v2-graph-with-viewpoints.json", "v3-timeline-programme.json", "table-rows-with-roles.json"]) {
  const verdict = judgeStructure(JSON.parse(readFileSync(new URL(`../../shared/conformance/valid/${name}`, import.meta.url), "utf8")));
  if (!verdict.valid) throw new Error(`${name} refused`);
  const html = embedPage({ mode: "structure", envelope: verdict.envelope });
  frames.push(`<h3>${name}</h3><iframe sandbox="allow-scripts allow-popups allow-downloads" style="width:1000px;height:520px;border:1px solid #444" srcdoc="${html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`);
}
writeFileSync(path.join(out, "owui-embeds.html"), `<!doctype html><body style="background:Canvas;color:CanvasText;color-scheme:light dark;font-family:sans-serif">${frames.join("\n")}</body>`);
