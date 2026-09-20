/**
 * The npm pi packages the agent loads, as Settings lists them — read through the SDK's
 * own package manager over a fixture agent directory.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { checkPiPackages, listPiPackages, parseNpmSource } from "../src/piPackages.ts";

/**
 * A fixture agent directory, sealed off from this machine's own installs.
 *
 * The SDK falls back to npm's global `node_modules` for a package it does not find
 * where it manages them — `npm root -g`, which on a developer's machine holds real
 * packages. Pointing npm's prefix at an empty directory keeps every lookup here, and
 * fixtures are written to the managed location computed by the test, never to a path
 * the SDK hands back.
 */
async function agentWith(packages: string[], installed: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-packages-"));
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  process.env.npm_config_prefix = path.join(root, "empty-global-prefix");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages }));
  for (const [source, version] of Object.entries(installed)) {
    const name = parseNpmSource(source)!.name;
    const at = path.join(agentDir, "npm", "node_modules", name);
    assert.ok(at.startsWith(root), "fixtures stay inside the test's own directory");
    await mkdir(at, { recursive: true });
    await writeFile(path.join(at, "package.json"), JSON.stringify({ name, version }));
  }
  return { cwd, agentDir };
}

describe("the pi packages Settings lists", () => {
  test("an installed package is listed with its name and installed version", async () => {
    // AnInstalledPackageIsListed
    const { cwd, agentDir } = await agentWith(["npm:@gotgenes/pi-permission-system"], { "npm:@gotgenes/pi-permission-system": "33.0.1" });
    assert.deepEqual(await listPiPackages(cwd, agentDir), [
      { source: "npm:@gotgenes/pi-permission-system", name: "@gotgenes/pi-permission-system", scope: "user", installed: "33.0.1" },
    ]);
  });

  test("a pinned package says so, one not installed has no version, and git sources are left out", async () => {
    // APinnedPackageIsSaidToBePinned
    const { cwd, agentDir } = await agentWith(["npm:openlore@3.1.1", "npm:not-installed", "git:github.com/acme/tools"], { "npm:openlore@3.1.1": "3.1.1" });
    assert.deepEqual(await listPiPackages(cwd, agentDir), [
      { source: "npm:openlore@3.1.1", name: "openlore", scope: "user", installed: "3.1.1", pinned: "3.1.1" },
      { source: "npm:not-installed", name: "not-installed", scope: "user" },
    ]);
  });

  test("a scoped name is not mistaken for a pinned version", () => {
    assert.deepEqual(parseNpmSource("npm:@scope/pkg"), { name: "@scope/pkg" });
    assert.deepEqual(parseNpmSource("npm:@scope/pkg@1.0.0"), { name: "@scope/pkg", pinned: "1.0.0" });
    assert.equal(parseNpmSource("git:github.com/x/y"), undefined);
  });
});

describe("looking up newer versions", () => {
  const entry = (name: string, installed?: string, pinned?: string) => ({
    source: `npm:${name}${pinned ? `@${pinned}` : ""}`,
    name,
    scope: "user" as const,
    ...(installed ? { installed } : {}),
    ...(pinned ? { pinned } : {}),
  });

  test("a newer published version is shown", async () => {
    // ANewerVersionIsShown
    const [checked] = await checkPiPackages([entry("newer-pkg", "33.0.1")], {
      enabled: true,
      disabledReason: "",
      lookup: async (name, installed) => ({ status: "newer", running: installed, latest: "33.1.0" }),
    });
    assert.deepEqual(checked.check, { state: "newer", latest: "33.1.0" });
  });

  test("a failed lookup is not up to date, says why, and is asked again next time", async () => {
    // AFailedCheckIsNotUpToDate
    let asked = 0;
    const options = {
      enabled: true,
      disabledReason: "",
      lookup: async (_name: string, installed: string) => {
        asked += 1;
        return { status: "failed" as const, running: installed, reason: "the registry answered 503" };
      },
    };
    const [first] = await checkPiPackages([entry("flaky-pkg", "1.0.0")], options);
    assert.deepEqual(first.check, { state: "failed", reason: "the registry answered 503" });
    await checkPiPackages([entry("flaky-pkg", "1.0.0")], options);
    assert.equal(asked, 2, "a failure is not kept as an answer");
  });

  test("with checking off nothing is looked up, and the list says so", async () => {
    // CheckingOffLooksUpNothing
    let asked = 0;
    const [checked] = await checkPiPackages([entry("off-pkg", "1.0.0")], {
      enabled: false,
      disabledReason: "update checks are turned off",
      lookup: async () => {
        asked += 1;
        return { status: "current", running: "1.0.0", latest: "1.0.0" };
      },
    });
    assert.equal(asked, 0);
    assert.deepEqual(checked.check, { state: "off", reason: "update checks are turned off" });
  });

  test("a pinned package or one not installed is not looked up", async () => {
    let asked = 0;
    const lookup = async () => {
      asked += 1;
      return { status: "newer" as const, running: "1.0.0", latest: "2.0.0" };
    };
    const checked = await checkPiPackages([entry("pinned-pkg", "1.0.0", "1.0.0"), entry("absent-pkg")], { enabled: true, disabledReason: "", lookup });
    assert.equal(asked, 0);
    assert.ok(checked.every((item) => item.check === undefined));
  });

  test("a recent answer is reused, and asking explicitly looks again", async () => {
    let asked = 0;
    const lookup = async (_name: string, installed: string) => {
      asked += 1;
      return { status: "current" as const, running: installed, latest: installed };
    };
    const now = 1_000_000;
    await checkPiPackages([entry("cached-pkg", "2.0.0")], { enabled: true, disabledReason: "", lookup, now });
    await checkPiPackages([entry("cached-pkg", "2.0.0")], { enabled: true, disabledReason: "", lookup, now: now + 1000 });
    assert.equal(asked, 1, "the second listing reused the answer");
    await checkPiPackages([entry("cached-pkg", "2.0.0")], { enabled: true, disabledReason: "", lookup, now: now + 2000, force: true });
    assert.equal(asked, 2, "an explicit check looks again");
  });
});
