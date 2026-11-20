/**
 * `sandbox.readOnlyPaths`: the user's tool directories, readable by every command of the agent's
 * confined shell — read from the file, and checked at each launch as a grant is. What reaches the
 * policy is `confinedBash.test.ts`'s.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { readOnlyPathsGrant, realResolve } from "../src/sandbox.ts";

describe("sandbox.readOnlyPaths", () => {
  let base: string;
  let root: string;
  let tools: string;
  let agentDir: string;
  before(async () => {
    base = await realResolve(await mkdtemp(path.join(tmpdir(), "read-only-paths-")));
    root = path.join(base, "project");
    tools = path.join(base, "tools", "python");
    agentDir = path.join(base, "agent");
    for (const dir of [root, tools, agentDir]) await mkdir(dir, { recursive: true });
  });
  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // openlore: scenario=ReadOnlyPathsAreReadFromTheFile spec=sandbox-runner-bash
  test("read from the file: relative paths are the configuration folder's; empty entries, or beside an image, are refused", async () => {
    const configPath = path.join(base, "config.json");
    const load = async (sandbox: Record<string, unknown>) => {
      await writeFile(configPath, JSON.stringify({ sandbox: { root: "project", allowBash: true, bashRunner: "./bin/landstrip", ...sandbox } }));
      return loadConfig(base, { config: configPath }).sandbox!;
    };
    assert.deepEqual((await load({ readOnlyPaths: ["tools/python", tools] })).readOnlyPaths, [tools, tools]);
    assert.equal((await load({})).readOnlyPaths, undefined);
    await assert.rejects(load({ readOnlyPaths: ["  "] }), /"sandbox\.readOnlyPaths" holds an empty path/);
    await assert.rejects(load({ readOnlyPaths: "tools" }), /"readOnlyPaths" must be an array of strings/);
    await assert.rejects(
      load({ bashRunner: "mxc", bashImage: "buildpack-deps:bookworm-scm", readOnlyPaths: [tools] }),
      /^Error: .*"sandbox\.readOnlyPaths" cannot reach bash in a WSLC container \("sandbox\.bashImage"\)/,
    );
  });

  // openlore: scenario=ConfiguredToolDirectoriesAreReadable spec=sandbox-runner-bash
  test("ConfiguredToolDirectoriesAreReadable: each existing directory is given read only; one never grantable, or gone, is skipped and said once", async () => {
    const lines: string[] = [];
    const context = { root, allowWrite: true, agentDir, home: path.join(base, "home") };
    const paths = [tools, agentDir, path.join(base, "gone"), path.join(root, "inside")];
    await mkdir(path.join(root, "inside"), { recursive: true });
    const first = await readOnlyPathsGrant(paths, context, (line) => lines.push(line));
    assert.deepEqual(first.directories, [{ path: tools, access: "read" }], "read only; what the root already gives is not repeated");
    assert.deepEqual(first.hosts, []);
    await readOnlyPathsGrant(paths, context, (line) => lines.push(line));
    assert.equal(lines.length, 2, `said once each: ${lines.join(" | ")}`);
    assert.match(lines.find((line) => line.includes(agentDir))!, /is skipped — the agent directory holds the provider keys/);
    assert.match(lines.find((line) => line.includes("gone"))!, /is skipped — it is not an existing directory/);
  });
});
