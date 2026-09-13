/**
 * The coverage run keeps dependencies' source maps out of its coverage files, and only theirs.
 *
 * Dropping our own maps would break the report — tsx's maps are what it reads lines through —
 * and forgetting the hook in the script would bring the ten-megabyte coverage files back
 * without any test noticing. Both are checked here, and the effect is measured on the one
 * dependency that made it matter: pdf.js, loaded under coverage in a child process.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import { withoutDependencySourceMaps } from "./stripDependencySourceMaps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..");

describe("withoutDependencySourceMaps", () => {
  const code = "export const x = 1;\n//# sourceMappingURL=pdf.worker.mjs.map\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==";

  test("removes every map comment from a dependency, the package's own and the inline one", () => {
    const stripped = withoutDependencySourceMaps("file:///repo/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", code);
    assert.doesNotMatch(stripped, /sourceMappingURL/);
    assert.match(stripped, /^export const x = 1;$/m);
  });

  test("leaves our own sources exactly as they are", () => {
    assert.equal(withoutDependencySourceMaps("file:///repo/server/src/pdf.ts", code), code);
  });

  test("leaves a dependency without map comments untouched", () => {
    const plain = "export const y = 2;\n";
    assert.equal(withoutDependencySourceMaps("file:///repo/node_modules/a/index.mjs", plain), plain);
  });
});

describe("the coverage run", () => {
  test("loads the hook after tsx", () => {
    const script = JSON.parse(readFileSync(path.join(SERVER, "package.json"), "utf8")).scripts["test:coverage"] as string;
    const tsxAt = script.indexOf("--import tsx/esm");
    const hookAt = script.indexOf("--import ./test/stripDependencySourceMaps.mjs");
    assert.notEqual(tsxAt, -1, "test:coverage no longer loads tsx");
    assert.notEqual(hookAt, -1, "test:coverage no longer loads the hook that keeps dependency maps out of coverage files");
    // Hooks registered later run first, so only a hook loaded after tsx sees tsx's output.
    assert.ok(hookAt > tsxAt, "the hook must be loaded after tsx");
  });

  const sink = mkdtempSync(path.join(tmpdir(), "pi-outpost-dependency-maps-"));
  after(() => rmSync(sink, { recursive: true, force: true }));

  test("stores no pdf.js source map in a process that loads pdf.js", () => {
    // pdf.js loaded under coverage, with tsx and the hook in the order the script uses.
    const loader = pathToFileURL(path.join(SERVER, "src", "pdf.ts")).href;
    execFileSync(
      process.execPath,
      ["--import", "tsx/esm", "--import", "./test/stripDependencySourceMaps.mjs", "--input-type=module", "--eval", `const { loadPdfjs } = await import(${JSON.stringify(loader)}); await loadPdfjs();`],
      { cwd: SERVER, env: { ...process.env, NODE_V8_COVERAGE: sink }, encoding: "utf8" },
    );
    const files = readdirSync(sink).map((name) => path.join(sink, name));
    assert.ok(files.length > 0, "the child wrote no coverage file");
    for (const file of files) {
      const cache = JSON.parse(readFileSync(file, "utf8"))["source-map-cache"] ?? {};
      assert.deepEqual(Object.keys(cache).filter((url) => url.includes("/node_modules/")), [], "a dependency's source map reached the coverage file");
      assert.ok(Object.keys(cache).some((url) => url.endsWith("/server/src/pdf.ts")), "our own source map was dropped too");
      assert.ok(statSync(file).size < 4 * 1024 * 1024, `${path.basename(file)} is ${statSync(file).size} bytes`);
    }
  });
});
