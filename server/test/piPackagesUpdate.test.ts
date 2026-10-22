/**
 * `pi-outpost update --extensions` as a function: the steps it is built from — listing,
 * looking up, installing — are injected, so every rule is checked without a registry
 * and nothing is installed. The real command over a real npm is
 * `piPackagesUpdateCommand.test.mjs`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PiPackageInfo } from "@pi-outpost/shared";
import { hintPiPackagesBehind, type PiPackageInstall, runPiPackagesUpdate } from "../src/piPackages.ts";
import type { VersionCheck } from "../src/update.ts";

const behind: PiPackageInfo = { source: "npm:pi-behind", name: "pi-behind", scope: "user", installed: "1.0.0" };
const pinned: PiPackageInfo = { source: "npm:pi-pinned@2.0.0", name: "pi-pinned", scope: "user", installed: "2.0.0", pinned: "2.0.0" };
const current: PiPackageInfo = { source: "npm:pi-current", name: "pi-current", scope: "project", installed: "3.0.0" };

/** A registry where each package's newest version is given, or the lookup fails. */
function registry(latest: Record<string, string | Error>) {
  const asked: string[] = [];
  const lookup = async (name: string, installed: string): Promise<VersionCheck> => {
    asked.push(name);
    const answer = latest[name];
    if (answer === undefined || answer instanceof Error) return { status: "failed", running: installed, reason: answer?.message ?? "no such package" };
    return answer === installed ? { status: "current", running: installed, latest: answer } : { status: "newer", running: installed, latest: answer };
  };
  return { lookup, asked };
}

/** Runs the command and keeps what it printed, what it installed, and its exit code. */
async function run(options: {
  packages: PiPackageInfo[];
  latest?: Record<string, string | Error>;
  checkOnly?: boolean;
  locked?: boolean;
  checkingDisabled?: boolean;
  install?: (entry: PiPackageInfo) => PiPackageInstall;
}) {
  const lines: string[] = [];
  const installed: string[] = [];
  const reg = registry(options.latest ?? {});
  const code = await runPiPackagesUpdate({
    checkOnly: options.checkOnly ?? false,
    ...(options.checkingDisabled ? { checkingDisabled: true, disabledReason: `"updateCheck" is false` } : {}),
    ...(options.locked ? { locked: true } : {}),
    list: async () => options.packages,
    lookup: reg.lookup,
    install: async (entry) => {
      installed.push(entry.name);
      const latest = options.latest?.[entry.name] as string;
      return options.install?.(entry) ?? { outcome: "installed", installed: latest, message: `${entry.name} ${latest} is installed` };
    },
    log: (line) => lines.push(line),
  });
  return { code, out: lines.join("\n"), installed, asked: reg.asked };
}

describe("pi-outpost update --extensions", () => {
  test("TheCheckListsThePackagesAndInstallsNothing", async () => {
    const { code, out, installed } = await run({ packages: [behind, pinned], latest: { "pi-behind": "1.1.0", "pi-pinned": "9.0.0" }, checkOnly: true });
    assert.match(out, /pi-behind 1\.0\.0 is installed; 1\.1\.0 is available/);
    assert.match(out, /pi-pinned is pinned at 2\.0\.0 — left as it is/);
    assert.doesNotMatch(out, /9\.0\.0/, "a pinned package is not offered anything");
    assert.deepEqual(installed, []);
    assert.equal(code, 0);
  });

  test("installs each package that has a newer version, and says it runs after a restart", async () => {
    // TheExtensionsAreUpdatedFromTheTerminal, the function's half: the real install is the process test's
    const { code, out, installed } = await run({ packages: [behind, pinned, current], latest: { "pi-behind": "1.1.0", "pi-current": "3.0.0" } });
    assert.deepEqual(installed, ["pi-behind"], "only the package behind, never the pinned or the current one");
    assert.match(out, /pi-current \(this project\) 3\.0\.0 is the newest published version/);
    assert.match(out, /pi-behind 1\.1\.0 is installed/);
    assert.match(out, /restart pi-outpost to run the updated package/);
    assert.doesNotMatch(out, /running|loaded/, "it does not claim the new version runs");
    assert.equal(code, 0);
  });

  test("AnInstallThatInstallsNothingIsAFailure", async () => {
    const { code, out } = await run({
      packages: [behind],
      latest: { "pi-behind": "1.1.0" },
      install: () => ({ outcome: "failed", message: "pi-behind is still at 1.0.0: the package manager installed nothing" }),
    });
    assert.match(out, /pi-behind is still at 1\.0\.0/);
    assert.doesNotMatch(out, /restart pi-outpost/, "nothing to restart for");
    assert.equal(code, 1);
  });

  test("AFailedLookupIsNotUpToDateInTheTerminal", async () => {
    const { code, out, installed } = await run({ packages: [behind, current], latest: { "pi-behind": new Error("getaddrinfo ENOTFOUND registry"), "pi-current": new Error("getaddrinfo ENOTFOUND registry") } });
    assert.match(out, /pi-behind 1\.0\.0: could not check — getaddrinfo ENOTFOUND registry/);
    assert.match(out, /pi-current \(this project\) 3\.0\.0: could not check/);
    assert.doesNotMatch(out, /newest published version|nothing to/);
    assert.deepEqual(installed, []);
    assert.equal(code, 1);
  });

  test("LockedExtensionsAreNotUpdatedFromTheTerminal", async () => {
    const { code, out, installed } = await run({ packages: [behind], latest: { "pi-behind": "1.1.0" }, locked: true });
    assert.match(out, /"extensionLock" is set: no pi package was updated/);
    assert.deepEqual(installed, []);
    assert.equal(code, 1);
  });

  test("CheckingOffLooksUpNoPackage", async () => {
    const { code, out, installed, asked } = await run({ packages: [behind], latest: { "pi-behind": "1.1.0" }, checkingDisabled: true });
    assert.deepEqual(asked, [], "no registry is contacted");
    assert.match(out, /update checking is disabled: "updateCheck" is false/);
    assert.deepEqual(installed, []);
    assert.equal(code, 1);
  });

  test("an unreadable settings file is said, and is not \"no package\"", async () => {
    const lines: string[] = [];
    const code = await runPiPackagesUpdate({
      checkOnly: false,
      list: async () => [],
      unlisted: async () => ({ unreadable: ["/agent/settings.json: Unexpected token"], unmanaged: ["git:github.com/x/y"] }),
      lookup: registry({}).lookup,
      install: async () => assert.fail("nothing to install"),
      log: (line) => lines.push(line),
    });
    assert.ok(lines.includes("[pi] could not read /agent/settings.json: Unexpected token"));
    assert.ok(lines.includes("[pi] not updated by pi-outpost (git or local): git:github.com/x/y"));
    assert.equal(code, 1);
  });

  test("with no package configured, says so and succeeds", async () => {
    const { code, out } = await run({ packages: [] });
    assert.match(out, /no npm pi package is configured/);
    assert.equal(code, 0);
  });
});

describe("the hint after a plain update", () => {
  test("APlainUpdateNamesTheExtensionsBehind", async () => {
    const lines: string[] = [];
    await hintPiPackagesBehind({
      list: async () => [behind, current],
      lookup: registry({ "pi-behind": "1.1.0", "pi-current": "3.0.0" }).lookup,
      log: (line) => lines.push(line),
    });
    assert.deepEqual(lines, ['[pi] a pi package has a newer version: pi-behind', '[pi]   "pi-outpost update --extensions" updates it']);
  });

  test("is silent when nothing is behind, when a lookup fails, and when listing throws", async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    await hintPiPackagesBehind({ list: async () => [current], lookup: registry({ "pi-current": "3.0.0" }).lookup, log });
    await hintPiPackagesBehind({ list: async () => [behind], lookup: registry({ "pi-behind": new Error("down") }).lookup, log });
    await hintPiPackagesBehind({ list: async () => { throw new Error("unreadable settings"); }, lookup: registry({}).lookup, log });
    assert.deepEqual(lines, []);
  });
});
