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
  // Hooks registered later run first, so only a hook loaded after tsx sees tsx's output.
  test("loads the hook after tsx in the test processes", () => {
    const script = JSON.parse(readFileSync(path.join(SERVER, "package.json"), "utf8")).scripts["test:coverage"] as string;
    assert.equal(script, "node scripts/test-coverage.mjs");
    const coverage = readFileSync(path.join(SERVER, "scripts", "test-coverage.mjs"), "utf8");
    assert.match(coverage, /"scripts\/test\.mjs", "--import", "\.\/test\/stripDependencySourceMaps\.mjs"/, "test:coverage no longer loads the hook that keeps dependency maps out of coverage files");
    // scripts/test.mjs puts tsx first and the arguments it is given after.
    const runner = readFileSync(path.join(SERVER, "scripts", "test.mjs"), "utf8");
    const tsxAt = runner.indexOf('"--import", "tsx/esm"');
    const forwardedAt = runner.indexOf("...process.argv.slice(2)");
    assert.notEqual(tsxAt, -1, "the server test runner no longer loads tsx");
    assert.ok(forwardedAt > tsxAt, "the hook must be loaded after tsx");
  });

  test("loads the hook after tsx in the servers a coverage run starts", () => {
    const harness = readFileSync(path.join(SERVER, "test", "harness.mjs"), "utf8");
    assert.match(harness, /\[TSX_LOADER, \.\.\.coverageImports, ENTRY\]/);
    assert.match(harness, /coverageImports = serverCoverageSink\(\) \? \[`--import=\$\{pathToFileURL\(path\.join\(SERVER_DIR, "test", "stripDependencySourceMaps\.mjs"\)\)\.href\}`\]/);
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
    // One file per thread the child ran: judged together, since only the thread that loaded
    // our code stores its map, and each on its own for what no file may carry.
    const files = readdirSync(sink)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(sink, name));
    assert.ok(files.length > 0, "the child wrote no coverage file");
    const cached: string[] = [];
    for (const file of files) {
      const urls = Object.keys(JSON.parse(readFileSync(file, "utf8"))["source-map-cache"] ?? {});
      assert.deepEqual(urls.filter((url) => url.includes("/node_modules/")), [], `a dependency's source map reached ${path.basename(file)}`);
      assert.ok(statSync(file).size < 4 * 1024 * 1024, `${path.basename(file)} is ${statSync(file).size} bytes`);
      cached.push(...urls);
    }
    assert.ok(cached.some((url) => url.endsWith("/server/src/pdf.ts")), `our own source map was dropped too; cached: ${cached.join(", ") || "nothing"}`);

    // The code V8 ran for our own sources is kept for the converter, and only theirs: the
    // coverage ranges point into tsx's output, not into the .ts on disk.
    const kept = readdirSync(path.join(sink, "sources")).map((name) => JSON.parse(readFileSync(path.join(sink, "sources", name), "utf8")) as { url: string; source: string });
    const pdf = kept.find(({ url }) => url.endsWith("/server/src/pdf.ts"));
    assert.ok(pdf, `the code that ran for server/src/pdf.ts was not kept; kept: ${kept.map(({ url }) => url).join(", ")}`);
    assert.doesNotMatch(pdf.source, /:\s*(?:string|number|boolean)\b[^\n]*[=;)]/, "kept the TypeScript, not the JavaScript tsx produced");
    assert.match(pdf.source, /sourceMappingURL=data:/, "the kept code carries the map back to the TypeScript");
    assert.deepEqual(kept.filter(({ url }) => url.includes("/node_modules/")), [], "a dependency's code was kept");
  });
});
