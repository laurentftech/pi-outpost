/**
 * `pi-outpost update --extensions`, `--all`, and the hint after a plain update — the
 * real command, run as a process from the TypeScript source, against a real npm and a
 * registry of the test's own (`fakePiPackages.mjs`).
 *
 * The agent directory is named with `--agent-dir`, and no configuration file exists:
 * the packages updated must be the ones in that directory, not `~/.pi/agent`. What was
 * installed is read back from disk, never inferred from the command's own words.
 *
 * The source reports version "dev", so pi-outpost itself is a checkout here — the one
 * copy the update command refuses to upgrade. That is the `--all` scenario's premise.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { envWithoutCoverageSink } from "./childEnv.mjs";
import { agentDirAtOldVersion, installedVersion } from "./fakePiPackages.mjs";

const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = path.join(SERVER_DIR, "src", "index.ts");
// Absolute: the command runs from a project directory outside this repository, where a
// bare "tsx/esm" would not resolve.
const TSX_LOADER = `--import=${import.meta.resolve("tsx/esm")}`;

async function setUp(t) {
  // pi-outpost answered for too, so the command's own check gets a verdict rather than a 404.
  const fixture = await agentDirAtOldVersion(t, "pi-packages-update-command-", { "pi-outpost": "99.0.0" });
  const project = path.join(fixture.scratch, "project");
  await mkdir(project, { recursive: true });
  return { ...fixture, project };
}

/** Runs `pi-outpost <args>` from the project directory, with nothing of this machine's own. */
function command(fixture, args) {
  const { scratch, reg, cache, emptyGlobal, project } = fixture;
  const env = envWithoutCoverageSink({
    // The launch directory npm would otherwise hand down from `npm test`.
    INIT_CWD: project,
    XDG_CONFIG_HOME: path.join(scratch, "no-user-config"),
    npm_config_registry: reg.url,
    npm_config_prefix: emptyGlobal,
    npm_config_cache: cache,
  });
  for (const key of ["PI_OUTPOST_CONFIG", "PI_OUTPOST_PROFILE", "PI_OUTPOST_CWD", "PI_OUTPOST_AGENT_DIR", "PI_CODING_AGENT_DIR", "PI_OFFLINE"]) delete env[key];
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [TSX_LOADER, ENTRY, ...args],
      { cwd: project, env, timeout: 240_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error?.killed) reject(new Error(`the command never finished:\n${stdout}${stderr}`));
        else resolve({ code: error ? error.code : 0, out: stdout, err: stderr });
      },
    );
    child.on("error", reject);
  });
}

test("TheExtensionsAreUpdatedFromTheTerminal", { timeout: 300_000 }, async (t) => {
  const fixture = await setUp(t);
  fixture.reg.state.published.add("1.1.0");
  fixture.reg.state.latest = "1.1.0";

  const checked = await command(fixture, ["update", "--extensions", "--check", "--agent-dir", fixture.agentDir]);
  assert.equal(checked.code, 0, checked.out + checked.err);
  assert.match(checked.out, /pi-fake-ext 1\.0\.0 is installed; 1\.1\.0 is available/);
  assert.equal(await installedVersion(fixture.agentDir), "1.0.0", "--check installs nothing");

  const updated = await command(fixture, ["update", "--extensions", "--agent-dir", fixture.agentDir]);
  assert.equal(updated.code, 0, updated.out + updated.err);
  assert.equal(await installedVersion(fixture.agentDir), "1.1.0", "installed in the directory --agent-dir names");
  assert.match(updated.out, /pi-fake-ext 1\.1\.0 is installed/);
  assert.match(updated.out, /restart pi-outpost to run the updated package/);
  assert.doesNotMatch(updated.out, /pi-outpost 99\.0\.0|source checkout/, "--extensions leaves pi-outpost alone");

  const again = await command(fixture, ["update", "--extensions", "--agent-dir", fixture.agentDir]);
  assert.equal(again.code, 0, again.out + again.err);
  assert.match(again.out, /pi-fake-ext 1\.1\.0 is the newest published version/);
});

test("AllUpdatesTheExtensionsEvenWhenPiOutpostIsRefused", { timeout: 300_000 }, async (t) => {
  const fixture = await setUp(t);
  fixture.reg.state.published.add("1.1.0");
  fixture.reg.state.latest = "1.1.0";

  const result = await command(fixture, ["update", "--all", "--agent-dir", fixture.agentDir]);
  assert.match(result.out, /this copy is a source checkout/, "pi-outpost itself is refused, and says why");
  assert.equal(await installedVersion(fixture.agentDir), "1.1.0", "the package is installed all the same");
  assert.match(result.out, /pi-fake-ext 1\.1\.0 is installed/);
  assert.notEqual(result.code, 0, "part of what was asked was not done");
});

test("APlainUpdateNamesTheExtensionsBehind", { timeout: 300_000 }, async (t) => {
  const fixture = await setUp(t);
  fixture.reg.state.published.add("1.1.0");
  fixture.reg.state.latest = "1.1.0";

  const result = await command(fixture, ["update", "--agent-dir", fixture.agentDir]);
  const out = result.out;
  const verdict = out.indexOf("source checkout");
  const hint = out.indexOf("a pi package has a newer version: pi-fake-ext");
  assert.ok(verdict >= 0 && hint > verdict, `the hint follows the verdict on pi-outpost:\n${out}`);
  assert.match(out, /"pi-outpost update --extensions" updates it/);
  assert.equal(await installedVersion(fixture.agentDir), "1.0.0", "a plain update installs no package");
});

/** A configuration file in the project directory, naming the agent directory itself. */
async function configured(fixture, settings) {
  await writeFile(path.join(fixture.project, "pi-outpost.config.json"), JSON.stringify({ agentDir: fixture.agentDir, ...settings }));
}

test("LockedExtensionsAreNotUpdatedFromTheTerminal", { timeout: 300_000 }, async (t) => {
  const fixture = await setUp(t);
  fixture.reg.state.published.add("1.1.0");
  fixture.reg.state.latest = "1.1.0";
  await configured(fixture, { extensionLock: true });

  const result = await command(fixture, ["update", "--extensions"]);
  assert.match(result.out, /pi-fake-ext 1\.0\.0 is installed; 1\.1\.0 is available/, "the agent directory comes from the configuration");
  assert.match(result.out, /"extensionLock" is set: no pi package was updated/);
  assert.equal(await installedVersion(fixture.agentDir), "1.0.0");
  assert.notEqual(result.code, 0);
});

test("CheckingOffLooksUpNoPackage", { timeout: 300_000 }, async (t) => {
  const fixture = await setUp(t);
  fixture.reg.state.published.add("1.1.0");
  fixture.reg.state.latest = "1.1.0";
  await configured(fixture, { updateCheck: false });
  const before = fixture.reg.state.requests;

  const result = await command(fixture, ["update", "--extensions"]);
  assert.match(result.out, /update checking is disabled: "updateCheck" is false/);
  assert.equal(fixture.reg.state.requests, before, "no registry is contacted");
  assert.equal(await installedVersion(fixture.agentDir), "1.0.0");
  assert.notEqual(result.code, 0);
});
