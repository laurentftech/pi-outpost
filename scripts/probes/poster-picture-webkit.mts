/**
 * Probe for poster-editor task 1.3: the page picture (posters/src/picture.ts) in WebKit
 * as well as Chromium, on real posters. Writes one PNG per poster and engine to look at.
 *
 * Run: node --import tsx scripts/probes/poster-picture-webkit.mts <out-dir> <revision.json>…
 * (a revision file from a posters folder: { html, css, format })
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, webkit } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const [out, ...posters] = process.argv.slice(2);
const SIZES: Record<string, [number, number]> = { "A4-portrait": [794, 1123], "A4-landscape": [1123, 794], "A3-portrait": [1123, 1587], "A3-landscape": [1587, 1123], "slide-16:9": [1280, 720] };
const script = (
  await build({ stdin: { contents: `import { pagePicture } from "./posters/src/picture.ts"; (window as any).pagePicture = pagePicture;`, resolveDir: path.resolve(here, "../.."), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" })
).outputFiles[0]!.text;

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><body><script>${script}</script></body>`);
  for (const file of posters) {
    const poster = JSON.parse(await fs.readFile(file, "utf8")) as { html: string; css: string; format: string };
    const [width, height] = SIZES[poster.format]!;
    const result = await page.evaluate(
      async ({ html, css, width: w, height: h }) => {
        try {
          const picture = await (window as unknown as { pagePicture: (p: { width: number; height: number }, html: string, css: string) => Promise<{ png: Uint8Array; width: number; height: number }> }).pagePicture({ width: w, height: h }, html, css);
          return { ok: true, png: Array.from(picture.png), width: picture.width, height: picture.height };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      },
      { html: poster.html, css: poster.css, width, height },
    );
    const name = `${path.basename(path.dirname(file))}-${engine.name()}.png`;
    if (result.ok) await fs.writeFile(path.join(out!, name), Buffer.from(result.png!));
    console.log(engine.name(), path.basename(path.dirname(file)), result.ok ? `${result.width}x${result.height} → ${name}` : `FAILED: ${result.error}`);
  }
  await browser.close();
}
