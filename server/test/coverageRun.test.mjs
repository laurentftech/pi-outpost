/**
 * The coverage run's contract with the harness: a server started while a coverage run
 * names its directory writes its V8 coverage there when stop() ends it, and the processes
 * that server starts in turn — here the agent child — still write none.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { buildReport } from "../../scripts/coverage-report.mjs";
import { COVERAGE_DIR_VARIABLE } from "./childEnv.mjs";
import { convertServerCoverage } from "./coverageConvert.mjs";
import { isUnder } from "./coverageFilter.mjs";
import { COVERAGE_STOP_GRACE_MS, makeWorkspace, startServer, STOP_GRACE_MS, stopGraceMs } from "./harness.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));
const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");

/** Run `body` with the coverage switch set to `value` (undefined: unset), then restore it. */
async function withCoverageDir(value, body) {
  const saved = process.env[COVERAGE_DIR_VARIABLE];
  if (value === undefined) delete process.env[COVERAGE_DIR_VARIABLE];
  else process.env[COVERAGE_DIR_VARIABLE] = value;
  try {
    return await body();
  } finally {
    if (saved === undefined) delete process.env[COVERAGE_DIR_VARIABLE];
    else process.env[COVERAGE_DIR_VARIABLE] = saved;
  }
}

const dirs = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

test("stop() keeps its short grace outside a coverage run and waits longer inside one", async () => {
  await withCoverageDir(undefined, () => assert.equal(stopGraceMs(), STOP_GRACE_MS));
  await withCoverageDir("", () => assert.equal(stopGraceMs(), STOP_GRACE_MS));
  await withCoverageDir(tmpdir(), () => assert.equal(stopGraceMs(), COVERAGE_STOP_GRACE_MS));
  assert.ok(COVERAGE_STOP_GRACE_MS > STOP_GRACE_MS);
});

// openlore: scenario=AgentChildReceivesNoCoverageSink spec=test-coverage
test(
  "AgentChildReceivesNoCoverageSink: a coverage-run server writes its coverage on stop, its agent child none",
  // Windows ends the server with `taskkill /F`, which leaves it no exit to write on; the
  // coverage run is Linux-only for that reason.
  { skip: process.platform === "win32" && "the coverage run is Linux-only: taskkill /F leaves no clean exit" },
  async () => {
    const coverageDir = await mkdtemp(path.join(tmpdir(), "pi-outpost-coverage-run-"));
    dirs.push(coverageDir);
    const root = await makeWorkspace({});
    const fakeConfig = path.join(root, "fake-rpc.json");
    const launchLog = path.join(root, "launch.json");
    await writeFile(fakeConfig, JSON.stringify({ launchLog }));

    await withCoverageDir(coverageDir, async () => {
      const server = await startServer(
        root,
        {
          agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 },
          sandbox: undefined,
          webContext: false,
        },
        { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
      );
      const launch = JSON.parse(await readFile(launchLog, "utf8"));
      await server.stop();
      assert.equal(launch.coverageDir, null, "the agent child must not inherit the coverage run's directory");
    });

    const files = (await readdir(coverageDir)).filter((name) => name.endsWith(".json"));
    assert.ok(files.length > 0, "the server wrote no coverage on stop");
    const urls = [];
    for (const name of files) {
      const { result } = JSON.parse(await readFile(path.join(coverageDir, name), "utf8"));
      urls.push(...result.map((entry) => fileURLToPath(entry.url.startsWith("file:") ? entry.url : `file://${entry.url}`)));
    }
    assert.ok(urls.includes(INDEX), "the server's coverage must include src/index.ts");
    // stop() filtered it already: nothing outside server/src is left for the run to carry.
    assert.deepEqual(urls.filter((file) => !isUnder(pathToFileURL(file).href)), []);

    // openlore: scenario=CodeReachedOnlyThroughTheServerProcessIsCovered spec=test-coverage
    // This test process never imports src/index.ts, so whatever the report counts as run
    // there was run by the server, converted and reported as the coverage run does it.
    const converted = path.join(coverageDir, "converted");
    await convertServerCoverage(coverageDir, converted);
    const report = await buildReport({ inputDirs: [path.join(converted, "raw")], outputDir: path.join(coverageDir, "report") });
    const index = report.scopes.find(({ name }) => name === "server").files.find((file) => file.path === "server/src/index.ts");
    assert.ok(index, "src/index.ts is missing from the report");
    assert.ok(index.summary.lines.covered > 1000, `only ${index.summary.lines.covered} lines of src/index.ts reported as run by the server`);
  },
);
