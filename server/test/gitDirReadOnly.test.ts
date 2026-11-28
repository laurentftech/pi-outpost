/**
 * The repository's `.git` is read-only to the agent's confined commands (`git-dir-read-only`): held
 * where it exists, given to each runner in its own words, opened by a write grant on it.
 *
 * The units here; the real runners in `gitDirReadOnlyRunners.test.ts`.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { canaryScript, expectedAttempts, readCanary, type CanaryBait } from "../src/confinementCanary.ts";
import { checkGrantRequest } from "../src/sandboxGrants.ts";
import { heldReadOnlyInside, mxcLinuxConfig, mxcMacConfig, mxcTerminalConfig, seatbeltPolicy, terminalPolicy } from "../src/terminalSandbox.ts";

describe("heldReadOnlyInside", () => {
  const present = () => true;
  const absent = () => false;

  test("the zone's .git, when it exists", () => {
    assert.deepEqual(heldReadOnlyInside("/work/app", { exists: present }), [path.join("/work/app", ".git")]);
  });

  // openlore: scenario=AMissingGitDirectoryIsNotHeld spec=sandbox-approved-grants
  test("AMissingGitDirectoryIsNotHeld: nothing to hold, so nothing is given to the runner (Bubblewrap would not start)", () => {
    assert.deepEqual(heldReadOnlyInside("/work/app", { exists: absent }), []);
  });

  test("not with gitWritable, nor without a writable zone, nor once a write grant names it or holds it", () => {
    assert.deepEqual(heldReadOnlyInside("/work/app", { exists: present, gitWritable: true }), []);
    assert.deepEqual(heldReadOnlyInside(undefined, { exists: present }), []);
    assert.deepEqual(heldReadOnlyInside("/work/app", { exists: present, grantedWrite: [path.join("/work/app", ".git")] }), []);
    assert.deepEqual(heldReadOnlyInside("/work/app", { exists: present, grantedWrite: [path.join("/work")] }), []);
    assert.deepEqual(heldReadOnlyInside("/work/app", { exists: present, grantedWrite: [path.join("/work/app", "src")] }), [path.join("/work/app", ".git")], "a grant elsewhere opens nothing of it");
  });
});

describe("each runner is given it in its own words", () => {
  const git = { posix: "/work/app/.git", windows: "C:\\work\\app\\.git" };
  const posix = { root: "/work/app", allowWrite: true, agentDir: "/home/me/.pi/agent", tmp: "/tmp/b", shell: "/bin/bash", shellArgs: ["/tmp/x.sh"], cwd: "/work/app", env: { PATH: "/usr/bin:/bin" } };
  const windows = {
    root: "C:\\work\\app",
    allowWrite: true,
    agentDir: "C:\\Users\\me\\.pi\\agent",
    tmp: "C:\\Users\\me\\AppData\\Local\\Temp\\b",
    shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    shellArgs: ["-File", "x.ps1"],
    cwd: "C:\\work\\app",
    env: { PATH: "C:\\Windows\\System32" },
  };

  test("MXC on Windows: a read-only path inside the writable root", () => {
    const config = mxcTerminalConfig({ ...windows, readOnlyInside: [git.windows] });
    assert.ok(config.filesystem.readwritePaths.includes("C:\\work\\app"));
    assert.ok(config.filesystem.readonlyPaths.includes(git.windows), JSON.stringify(config.filesystem));
  });

  test("MXC on Linux and macOS: kept although it lies under a writable path", () => {
    for (const build of [mxcLinuxConfig, mxcMacConfig]) {
      const config = build({ ...posix, readOnlyInside: [git.posix], exists: () => true } as never);
      assert.ok(config.filesystem.readwritePaths.includes("/work/app"));
      assert.ok(config.filesystem.readonlyPaths.includes(git.posix), `${build.name}: ${JSON.stringify(config.filesystem.readonlyPaths)}`);
    }
  });

  test("Seatbelt: a write denial after the allows, the last matching rule winning", () => {
    const { seatbelt } = seatbeltPolicy({ ...posix, readOnlyInside: [git.posix], exists: () => true } as never);
    const allow = seatbelt.indexOf('(allow file-read* file-write* (subpath "/work/app"))');
    const deny = seatbelt.indexOf('(deny file-write* (subpath "/work/app/.git"))');
    assert.ok(allow >= 0 && deny > allow, seatbelt);
  });

  test("landstrip: denyWrite, on Linux and on Windows", () => {
    assert.deepEqual(terminalPolicy({ ...posix, platform: "linux", readOnlyInside: [git.posix] }).filesystem.denyWrite, [git.posix]);
    assert.deepEqual(terminalPolicy({ ...windows, platform: "win32", systemRoot: "C:\\Windows", readOnlyInside: [git.windows] }).filesystem.denyWrite, ["C:/work/app/.git"]);
  });

  test("nothing held: no field, the policies as before", () => {
    assert.equal(terminalPolicy({ ...posix, platform: "linux" }).filesystem.denyWrite, undefined);
    assert.ok(!seatbeltPolicy({ ...posix, exists: () => true } as never).seatbelt.includes("deny file-write*"));
  });
});

describe("a write grant on .git is a grant", () => {
  let base: string;
  let root: string;
  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "git-held-grant-"));
    root = path.join(base, "app");
    await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
  });
  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  // openlore: scenario=ACommitAsksForAGrant spec=sandbox-approved-grants
  test("ACommitAsksForAGrant (the server's half): writing .git, or a folder in it, is asked; the rest of the root is already given", async () => {
    const context = { root, allowWrite: true, agentDir: path.join(base, "agent") };
    const git = await checkGrantRequest({ directories: [{ path: ".git", access: "write" }] }, context);
    assert.ok(git.ok && git.grant.directories.length === 1 && git.grant.directories[0].path.endsWith(".git"), JSON.stringify(git));
    const hooks = await checkGrantRequest({ directories: [{ path: ".git/hooks", access: "write" }] }, context);
    assert.ok(hooks.ok && hooks.grant.directories.length === 1, JSON.stringify(hooks));
    const whole = await checkGrantRequest({ directories: [{ path: ".", access: "write" }] }, context);
    assert.ok(whole.ok && whole.grant.directories.length === 0, "the root itself is given: it opens no .git");
    const read = await checkGrantRequest({ directories: [{ path: ".git", access: "read" }] }, context);
    assert.ok(read.ok && read.grant.directories.length === 0, "reading it is given");
  });

  test("with gitWritable, .git is given like the rest", async () => {
    const result = await checkGrantRequest({ directories: [{ path: ".git", access: "write" }] }, { root, allowWrite: true, gitWritable: true });
    assert.ok(result.ok && result.grant.directories.length === 0);
  });
});

describe("the canary tries .git with a file of its own", () => {
  const bait = (heldTarget?: string): CanaryBait => ({
    id: "1",
    envName: "PI_OUTPOST_CANARY_1",
    envValue: "canary-1",
    notChecked: [],
    ...(heldTarget ? { heldTarget } : {}),
    cleanup: async () => {},
  });

  test("its script tries the file, in both shells, and only when something is held", () => {
    const target = "/work/app/.git/.pi-outpost-canary-1";
    assert.match(canaryScript(bait(target), { powerShell: false, proxied: false, serverPid: 1 }), /\.pi-outpost-canary-1'\) 2>\/dev\/null; r write-git-dir/);
    assert.match(canaryScript(bait(target), { powerShell: true, proxied: false, serverPid: 1 }), /Report-Canary write-git-dir/);
    assert.ok(expectedAttempts(bait(target), { proxied: false }).includes("write-git-dir"));
    assert.ok(!expectedAttempts(bait(), { proxied: false }).includes("write-git-dir"));
  });

  // openlore: scenario=TheCanarySeesAWritableGitDirectory spec=sandbox-approved-grants
  test("TheCanarySeesAWritableGitDirectory: the file found on the host is a write that got through, whatever the command said", () => {
    const expected = expectedAttempts(bait("/x/.git/.c"), { proxied: false });
    const said = expected.map((attempt) => `PI_OUTPOST_CANARY ${attempt} refused`).join("\n");
    const leaked = readCanary(said, expected, { wroteHeld: true }, { runner: "r", checkedAt: "t", notChecked: [] });
    assert.equal(leaked.state, "leaking");
    assert.ok(leaked.state === "leaking" && leaked.reached.includes("write-git-dir"));
    const held = readCanary(said, expected, { wroteHeld: false }, { runner: "r", checkedAt: "t", notChecked: [] });
    assert.equal(held.state, "verified");
  });
});
