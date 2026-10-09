import assert from "node:assert/strict";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { checkRunner, confinedEnvironment, prepareConfinedTerminal, terminalPolicy } from "../src/terminalSandbox.ts";

// The Linux policy, whatever host runs the test: POSIX paths, platform pinned.
const p = (...parts: string[]) => path.posix.join("/", ...parts);
const linux = { platform: "linux" as const };
const root = p("work", "app");
const tmp = p("tmp", "pi-outpost-terminal-1");
const agentDir = p("srv", "agent");
const configFile = p("etc", "pi-outpost", "config.json");

describe("terminalPolicy", () => {
  test("reading is an allowlist: the root, the system trees, the temp; secrets denied by name", () => {
    const policy = terminalPolicy({ ...linux, root, writableRoot: path.posix.join(root, "out"), allowWrite: true, agentDir, configFile, tmp });
    assert.equal(policy.filesystem.denyRead[0], "/", "everything not allowed back is unreadable");
    for (const needed of ["/usr", "/etc", "/lib", "/dev", "/proc", root, tmp]) assert.ok(policy.filesystem.allowRead.includes(needed), needed);
    // The agent directory holds the provider keys; the configuration names everything.
    // Denied by name, so they stay unreadable even under an allowed tree.
    assert.ok(policy.filesystem.denyRead.includes(agentDir));
    assert.ok(policy.filesystem.denyRead.includes(configFile));
    assert.ok(!policy.filesystem.allowRead.includes(path.posix.dirname(root)), "siblings of the root are not allowed back");
    assert.equal(policy.network.allowNetwork, true);
  });

  test("a sandbox with a writable zone: write only the zone", () => {
    const policy = terminalPolicy({ ...linux, root, writableRoot: path.posix.join(root, "out"), allowWrite: true, agentDir, configFile, tmp });
    assert.deepEqual(policy.filesystem.allowWrite, [path.posix.join(root, "out"), tmp, "/dev/null", "/dev/tty", "/dev/pts"]);
  });

  test("a sandbox allowing writes with no writable zone: the whole root is writable", () => {
    const policy = terminalPolicy({ ...linux, root, allowWrite: true, agentDir, configFile, tmp });
    assert.equal(policy.filesystem.allowWrite[0], root);
  });

  test("a read-only sandbox: only the private temp and the tty devices are writable", () => {
    const policy = terminalPolicy({ ...linux, root, writableRoot: path.posix.join(root, "out"), allowWrite: false, agentDir, configFile, tmp });
    assert.deepEqual(policy.filesystem.allowWrite, [tmp, "/dev/null", "/dev/tty", "/dev/pts"]);
  });

  test("no sandbox configured: the project root is the root, read and write", () => {
    const project = p("home", "me", "proj");
    const policy = terminalPolicy({ ...linux, root: project, allowWrite: true, tmp });
    assert.ok(policy.filesystem.allowRead.includes(project));
    assert.equal(policy.filesystem.allowWrite[0], project);
    assert.deepEqual(policy.filesystem.denyRead, ["/"]);
  });

  test("the search path makes tools outside the system trees readable, never the whole disk", () => {
    const tool = p("opt", "hostedtoolcache", "node", "22", "x64");
    const searchPath = [path.posix.join(tool, "bin"), p("usr", "local", "sbin"), "relative/bin", p("bin")].join(":");
    const policy = terminalPolicy({ ...linux, root, allowWrite: true, tmp, searchPath });
    assert.ok(policy.filesystem.allowRead.includes(tool), "an installation's bin brings its installation");
    assert.ok(policy.filesystem.allowRead.includes(p("usr", "local", "sbin")));
    assert.ok(!policy.filesystem.allowRead.some((entry) => entry.startsWith("relative")), "a relative entry names nothing fixed");
    assert.ok(!policy.filesystem.allowRead.includes(p()), "a /bin entry must not allow / back");
  });
});

describe("terminalPolicy on Windows", () => {
  const win = { platform: "win32" as const, systemRoot: "C:\\Windows" };
  const wroot = "C:\\Users\\me\\work\\app";
  const wtmp = "C:\\Users\\me\\AppData\\Local\\Temp\\pi-outpost-terminal-1";

  test("a drive root is denied, or landstrip refuses the policy as unrestricted", () => {
    const policy = terminalPolicy({ ...win, root: wroot, allowWrite: true, tmp: wtmp });
    assert.ok(policy.filesystem.denyRead.includes("C:/"), JSON.stringify(policy.filesystem.denyRead));
  });

  test("paths are written with forward slashes, the system and the root re-allowed", () => {
    const policy = terminalPolicy({
      ...win,
      root: wroot,
      writableRoot: wroot + "\\out",
      allowWrite: true,
      tmp: wtmp,
      agentDir: "C:\\Users\\me\\.pi\\agent",
      searchPath: "C:\\Program Files\\Git\\bin;relative\\bin;D:\\tools",
    });
    assert.deepEqual(policy.filesystem.allowRead, ["C:/Windows", "C:/Program Files/Git", "D:/tools", "C:/Users/me/work/app", "C:/Users/me/AppData/Local/Temp/pi-outpost-terminal-1"]);
    // Every drive named is denied as a whole; secrets by name.
    assert.deepEqual(policy.filesystem.denyRead, ["C:/", "D:/", "C:/Users/me/.pi/agent"]);
    assert.deepEqual(policy.filesystem.allowWrite, ["C:/Users/me/work/app/out", "C:/Users/me/AppData/Local/Temp/pi-outpost-terminal-1"]);
    // lpac refused git even where it was allowed; standard runs it.
    assert.deepEqual(policy.windows, { appContainerMode: "standard" });
  });
});

describe("confinedEnvironment", () => {
  // openlore: scenario=KeysDoNotReachTheShell spec=terminal
  test("keys and other server variables stay out; the shell's own basics are set", () => {
    const env = confinedEnvironment(
      { PATH: "/usr/bin", LANG: "fr_FR.UTF-8", LC_ALL: "C", OPENAI_API_KEY: "sk-secret", PI_OUTPOST_TOKEN: "t", HOME: "/home/server" },
      { root, tmp, shell: "/bin/bash" },
    );
    assert.deepEqual(env, { PATH: "/usr/bin", LANG: "fr_FR.UTF-8", LC_ALL: "C", TERM: "xterm-256color", SHELL: "/bin/bash", HOME: root, TMPDIR: tmp });
  });
});

describe("prepareConfinedTerminal", () => {
  test("writes the policy owner-only into a private directory that dispose removes", async () => {
    const files = await prepareConfinedTerminal((dir) => terminalPolicy({ root, allowWrite: true, tmp: dir }));
    const written = JSON.parse(await readFile(files.policyFile, "utf8"));
    assert.ok(written.filesystem.allowRead.includes(files.tmp), "the private dir is the policy's temp");
    if (process.platform !== "win32") assert.equal((await stat(files.policyFile)).mode & 0o777, 0o600);
    await files.dispose();
    await assert.rejects(stat(files.tmp));
  });
});

describe("checkRunner", () => {
  test("a missing runner is a reason naming the path, not a throw", async () => {
    const missing = p("nowhere", "landstrip");
    const result = await checkRunner(missing);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason.includes(missing));
  });

  test("doctor answering ok is usable; anything else carries the runner's words", async () => {
    const exe = process.execPath; // exists and is executable everywhere
    assert.deepEqual(await checkRunner(exe, async () => ({ stdout: '{"ok":true,"implementation":"landlock+seccomp"}\n', stderr: "" })), { ok: true });
    const refused = await checkRunner(exe, async () => ({ stdout: '{"ok":false,"error":"no landlock"}\n', stderr: "" }));
    assert.ok(!refused.ok && /no landlock/.test(refused.reason));
    const crashed = await checkRunner(exe, async () => {
      throw Object.assign(new Error("Command failed"), { stderr: "seccomp: operation not permitted" });
    });
    assert.ok(!crashed.ok && /operation not permitted/.test(crashed.reason));
    // Exiting non-zero with a JSON report: the report's words, not the JSON.
    const exited = await checkRunner(exe, async () => {
      throw Object.assign(new Error("Command failed"), { stdout: '{"ok":false,"error":"landlock is not available"}\n', stderr: "" });
    });
    assert.ok(!exited.ok && exited.reason.endsWith(": landlock is not available"), !exited.ok ? exited.reason : "");
  });
});
