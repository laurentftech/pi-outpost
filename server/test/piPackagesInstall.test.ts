/**
 * Adding, removing and restoring an npm pi package from Settings, over a real npm and a
 * registry of the test's own (`fakePiPackages.mjs`): what lands in the settings files and
 * in `node_modules` is read back from disk, never inferred from a return value.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test, type TestContext } from "node:test";
import { installPiPackage, listPiPackages, lookupPiPackage, removePiPackage, restorePiPackage } from "../src/piPackages.ts";
import { fetchPublishedVersion, type PublishedVersion } from "../src/update.ts";
import type { PiPackageInfo } from "@pi-outpost/shared";
import { NAME, agentDirAtOldVersion } from "./fakePiPackages.mjs";

/** npm, pointed at the test's registry, cache and an empty global prefix, for one test. */
function useNpmOf(t: TestContext, fixture: { reg: { url: string }; cache: string; emptyGlobal: string }) {
  const keys = ["npm_config_registry", "npm_config_cache", "npm_config_prefix"] as const;
  const before = keys.map((key) => process.env[key]);
  process.env.npm_config_registry = fixture.reg.url;
  process.env.npm_config_cache = fixture.cache;
  process.env.npm_config_prefix = fixture.emptyGlobal;
  t.after(() => keys.forEach((key, i) => (before[i] === undefined ? delete process.env[key] : (process.env[key] = before[i]))));
}

async function fixture(t: TestContext, prefix: string) {
  const made = await agentDirAtOldVersion(t, prefix);
  useNpmOf(t, made);
  const cwd = path.join(made.scratch, "project");
  await mkdir(cwd, { recursive: true });
  return { ...made, cwd };
}

const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8")) as { packages?: unknown[]; npmCommand?: string[] };
const userPackages = async (agentDir: string) => (await readJson(path.join(agentDir, "settings.json"))).packages ?? [];
const projectPackages = async (cwd: string) => (await readJson(path.join(cwd, ".pi", "settings.json")).catch(() => ({ packages: [] }))).packages ?? [];

describe("looking a package up before installing it", () => {
  const listed: PiPackageInfo[] = [
    { source: "npm:pi-present", name: "pi-present", scope: "user", installed: "1.0.0" },
    { source: "npm:pi-gone", name: "pi-gone", scope: "project", removed: true, loaded: "2.0.0" },
  ];
  const answering = (answer: PublishedVersion) => {
    const asked: string[] = [];
    return { asked, published: async (name: string, version?: string) => (asked.push(`${name}@${version ?? "latest"}`), answer) };
  };

  test("AnUnknownPackageIsRefusedInPlace: a name the registry does not know is refused, and nothing is installed", async () => {
    const { published } = answering({ status: "missing" });
    assert.deepEqual(await lookupPiPackage({ name: "nope-xyz", scope: "user" }, listed, published), {
      outcome: "refused",
      message: "nope-xyz was not found on the registry",
    });
    assert.deepEqual(await lookupPiPackage({ name: "openlore", version: "9.9.9", scope: "user" }, listed, published), {
      outcome: "refused",
      message: "openlore 9.9.9 was not found on the registry",
    });
  });

  test("AConfiguredPackageIsNotAddedTwice: a package already in that scope is refused without asking the registry", async () => {
    const { asked, published } = answering({ status: "found", version: "1.0.0" });
    const answer = await lookupPiPackage({ name: "pi-present", scope: "user" }, listed, published);
    assert.deepEqual(answer, { outcome: "refused", message: "pi-present is already in the agent's settings" });
    assert.deepEqual(asked, []);
    // The same name in the other scope is a different entry, and is looked up.
    assert.equal((await lookupPiPackage({ name: "pi-present", scope: "project" }, listed, published)).outcome, "found");
  });

  test("AddingARemovedPackagePointsAtUndo: a package removed since the start is refused, pointing at the undo", async () => {
    const { asked, published } = answering({ status: "found", version: "2.0.0" });
    const answer = await lookupPiPackage({ name: "pi-gone", scope: "project" }, listed, published);
    assert.equal(answer.outcome, "refused");
    assert.match(answer.message, /removed and still runs until pi-outpost restarts — undo the removal/);
    assert.deepEqual(asked, []);
  });

  test("a name or version that is not one never reaches npm", async () => {
    const { asked, published } = answering({ status: "found", version: "1.0.0" });
    for (const name of ["Bad Name", "a&calc", "../x", ""]) {
      assert.equal((await lookupPiPackage({ name, scope: "user" }, [], published)).outcome, "refused", name);
    }
    for (const version of ["^1.0.0", "latest", "1.0.0 & calc", "next"]) {
      const answer = await lookupPiPackage({ name: "openlore", version, scope: "user" }, [], published);
      assert.match(answer.message, /is not an exact version/, version);
    }
    assert.deepEqual(asked, []);
  });

  test("a registry that cannot be asked says so, and is not taken for a missing package", async () => {
    const { published } = answering({ status: "failed", reason: "getaddrinfo ENOTFOUND registry" });
    assert.deepEqual(await lookupPiPackage({ name: "npm:openlore", scope: "user" }, [], published), {
      outcome: "refused",
      message: "openlore could not be looked up: getaddrinfo ENOTFOUND registry",
    });
  });

  test("a found package names the version an install would get", async () => {
    const { published } = answering({ status: "found", version: "2.4.1" });
    assert.deepEqual(await lookupPiPackage({ name: "openlore", scope: "user" }, [], published), { outcome: "found", version: "2.4.1", message: "openlore 2.4.1" });
  });
});

describe("the registry's answer for one package and version", () => {
  test("no answer is a missing version, a 404 a missing package, anything else a failure", async () => {
    assert.deepEqual(await fetchPublishedVersion("x", "1.0.0", { lookupImpl: async () => undefined }), { status: "missing" });
    assert.deepEqual(await fetchPublishedVersion("x", undefined, { lookupImpl: async () => { throw new Error("404 Not Found - GET http://r/x (E404)"); } }), { status: "missing" });
    assert.deepEqual(await fetchPublishedVersion("x", undefined, { lookupImpl: async () => { throw new Error("ECONNREFUSED"); } }), { status: "failed", reason: "ECONNREFUSED" });
    assert.deepEqual(await fetchPublishedVersion("x", undefined, { lookupImpl: async () => ({ not: "a version" }) }), { status: "failed", reason: "npm answered without a version" });
    assert.deepEqual(await fetchPublishedVersion("x", undefined, { lookupImpl: async () => "3.0.0" }), { status: "found", version: "3.0.0" });
  });

  test("ALookupUsesTheInstallationsRegistry: npm asks the registry its configuration names", async (t) => {
    const made = await agentDirAtOldVersion(t, "pi-lookup-");
    // The registry only in a user .npmrc, as on a machine behind a private proxy.
    const npmrc = path.join(made.scratch, "npmrc");
    await writeFile(npmrc, `registry=${made.reg.url}\n`);
    const before = process.env.npm_config_userconfig;
    process.env.npm_config_userconfig = npmrc;
    t.after(() => (before === undefined ? delete process.env.npm_config_userconfig : (process.env.npm_config_userconfig = before)));
    const requests = made.reg.state.requests;

    made.reg.state.published.add("1.1.0");
    assert.deepEqual(await fetchPublishedVersion(NAME, undefined), { status: "found", version: "1.0.0" });
    assert.deepEqual(await fetchPublishedVersion(NAME, "1.1.0"), { status: "found", version: "1.1.0" });
    assert.deepEqual(await fetchPublishedVersion(NAME, "9.9.9"), { status: "missing" });
    assert.deepEqual(await fetchPublishedVersion("pi-nope-xyz", undefined), { status: "missing" });
    assert.ok(made.reg.state.requests > requests, "the private registry was asked");
  });
});

describe("installing, removing and restoring a package", () => {
  test("AConfirmedRemovalIsListedUntilARestart and UndoRestoresWhatIsRunning, then installs into either settings", async (t) => {
    const { agentDir, cwd, reg } = await fixture(t, "pi-install-");
    const entry = (await listPiPackages(cwd, agentDir)).find((candidate) => candidate.name === NAME)!;
    assert.equal(entry.installed, "1.0.0");

    // Removed: out of the agent's settings, and off the disk.
    const removed = await removePiPackage(cwd, agentDir, entry);
    assert.equal(removed.outcome, "removed", removed.message);
    assert.match(removed.message, /stops running when pi-outpost restarts/);
    assert.deepEqual(await userPackages(agentDir), []);
    assert.deepEqual(await listPiPackages(cwd, agentDir), []);

    // Restored at the version still running, under the same source.
    reg.state.published.add("1.1.0");
    reg.state.latest = "1.1.0";
    const restored = await restorePiPackage(cwd, agentDir, { name: NAME, scope: "user", source: `npm:${NAME}`, version: "1.0.0" });
    assert.equal(restored.outcome, "restored", restored.message);
    assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`], "unpinned, as it was");
    assert.equal((await listPiPackages(cwd, agentDir))[0]?.installed, "1.0.0", "the running version, not the newest");

    // AProjectInstallGoesToTheProjectsSettings + AVersionGivenIsPinned
    const pinned = await installPiPackage(cwd, agentDir, { name: NAME, version: "1.1.0", scope: "project" });
    assert.equal(pinned.outcome, "installed", pinned.message);
    assert.match(pinned.message, /restart pi-outpost to use it/);
    assert.deepEqual(await projectPackages(cwd), [`npm:${NAME}@1.1.0`]);
    assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`], "the agent's settings are untouched");
    const project = (await listPiPackages(cwd, agentDir)).find((candidate) => candidate.scope === "project");
    assert.deepEqual(project, { source: `npm:${NAME}@1.1.0`, name: NAME, scope: "project", installed: "1.1.0", pinned: "1.1.0" });
  });

  test("AConfirmedInstallIsListedAndAsksForARestart: an install into the agent's settings records it unpinned", async (t) => {
    const { agentDir, cwd } = await fixture(t, "pi-install-user-");
    await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
    const result = await installPiPackage(cwd, agentDir, { name: NAME, scope: "user" });
    assert.equal(result.outcome, "installed", result.message);
    assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`]);
    assert.equal((await listPiPackages(cwd, agentDir))[0]?.installed, "1.0.0");
  });

  test("an unpinned install gets the version confirmed, not a newer latest, and stays unpinned", async (t) => {
    const { agentDir, cwd, reg } = await fixture(t, "pi-install-exact-");
    reg.state.published.add("1.1.0");
    reg.state.latest = "1.1.0";
    const result = await installPiPackage(cwd, agentDir, { name: NAME, scope: "project", exact: "1.0.0" });
    assert.equal(result.outcome, "installed", result.message);
    assert.deepEqual(await projectPackages(cwd), [`npm:${NAME}`]);
    assert.equal((await listPiPackages(cwd, agentDir)).find((entry) => entry.scope === "project")?.installed, "1.0.0");
  });

  test("a removal whose settings cannot be written puts the package back", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async (t) => {
    // AFailedRemovalChangesNothing, when the uninstall succeeded and the settings write did not
    const { agentDir, cwd } = await fixture(t, "pi-remove-unwritable-");
    const { chmod } = await import("node:fs/promises");
    const entry = (await listPiPackages(cwd, agentDir))[0]!;
    await chmod(agentDir, 0o555);
    t.after(() => chmod(agentDir, 0o755));
    const result = await removePiPackage(cwd, agentDir, entry);
    await chmod(agentDir, 0o755);
    assert.equal(result.outcome, "failed", result.message);
    assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`]);
    assert.equal((await listPiPackages(cwd, agentDir))[0]?.installed, "1.0.0", "the code is back on disk");
  });

  test("AFailedInstallLeavesTheSettingsAlone: a registry that withholds the tarball configures nothing", async (t) => {
    const { agentDir, cwd, reg } = await fixture(t, "pi-install-fail-");
    reg.state.published.add("1.1.0");
    reg.state.withholdTarballs = true;
    const result = await installPiPackage(cwd, agentDir, { name: NAME, version: "1.1.0", scope: "project" });
    assert.equal(result.outcome, "failed");
    assert.match(result.message, new RegExp(`^${NAME} was not installed: `));
    assert.deepEqual(await projectPackages(cwd), []);
    // Not configured, not installed: nothing in the project's settings to wait on a restart.
    assert.deepEqual((await listPiPackages(cwd, agentDir)).filter((entry) => entry.scope === "project"), []);
  });

  test("AFailedRemovalChangesNothing: a package manager that cannot run leaves the package configured and installed", async (t) => {
    const { agentDir, cwd } = await fixture(t, "pi-remove-fail-");
    const settings = await readJson(path.join(agentDir, "settings.json"));
    await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ ...settings, npmCommand: [path.join(agentDir, "no-such-npm")] }));
    const entry = (await listPiPackages(cwd, agentDir))[0]!;
    const result = await removePiPackage(cwd, agentDir, entry);
    assert.equal(result.outcome, "failed");
    assert.match(result.message, new RegExp(`^${NAME} was not removed: `));
    assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`]);
    assert.equal((await listPiPackages(cwd, agentDir))[0]?.installed, "1.0.0");

    const install = await installPiPackage(cwd, agentDir, { name: NAME, scope: "project" });
    assert.equal(install.outcome, "failed", "an install through the same broken npm fails too");
    assert.deepEqual(await projectPackages(cwd), []);
    const restore = await restorePiPackage(cwd, agentDir, { name: NAME, scope: "project", source: `npm:${NAME}`, version: "1.0.0" });
    assert.equal(restore.outcome, "failed");
    assert.deepEqual(await projectPackages(cwd), [], "a failed restore configures nothing");
  });
});
