/**
 * A real bundled bridge, run outside node_modules: theme JSON paths stop being
 * valid after esbuild relocates the SDK. The generated SDK theme must keep the
 * status coloured instead of throwing during server startup.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import esbuild from "esbuild";

const run = promisify(execFile);

test("bundled semantic statuses keep colours without SDK theme files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-theme-bundle-"));
  try {
    const outfile = path.join(root, "bridge.mjs");
    const result = await esbuild.build({
      stdin: {
        contents: `
          import { ExtensionUiBridge } from "./extensionUiBridge.ts";
          import { parseAnsi } from "../../ui/src/util/ansi.ts";
          const sent = [];
          const ui = new ExtensionUiBridge(request => sent.push(request)).createContext();
          // Spreading the context reads its theme getter, as SDK binding does.
          const { theme } = { ...ui };
          ui.setStatus("blackhole", theme.fg("success", "bh") + theme.fg("warning", "warning") + theme.fg("error", "error"));
          console.log(JSON.stringify({ request: sent[0], segments: parseAnsi(sent[0].statusText) }));
        `,
        resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      write: false,
      banner: { js: "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);" },
    });
    await writeFile(outfile, result.outputFiles[0].contents);
    const { stdout } = await run(process.execPath, [outfile], { cwd: root, maxBuffer: 1024 * 1024 });
    const { request, segments } = JSON.parse(stdout.trim());
    assert.equal(request.statusKey, "blackhole");
    assert.equal(request.method, "setStatus");
    assert.deepEqual(segments.map(segment => segment.text), ["bh", "warning", "error"]);
    assert.ok(segments.every(segment => typeof segment.color === "string" && segment.color.length > 0));
    assert.equal(new Set(segments.map(segment => segment.color)).size, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
