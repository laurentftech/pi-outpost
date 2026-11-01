import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, readFile, symlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { envWithoutCoverageSink } from "./childEnv.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  checkRunner,
  windowsBuildAdvice,
  confinedEnvironment,
  gitReadOnlyFiles,
  isLinuxMxc,
  isMacMxc,
  mxcErrorMessage,
  mxcLinuxConfig,
  mxcMacConfig,
  mxcPosixConfig,
  sbplString,
  seatbeltPolicy,
  mxcTerminalConfig,
  readableSearchEntries,
  prepareConfinedTerminal,
  quotePosixArgument,
  quoteWindowsArgument,
  runnerKind,
  siblingsToDeny,
  terminalPolicy,
  userGitConfig,
} from "../src/terminalSandbox.ts";

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

  test("search-path entries inside the user's profile are left out: per-user installs cost seconds per launch", () => {
    const policy = terminalPolicy({
      ...win,
      root: wroot,
      allowWrite: true,
      tmp: wtmp,
      userProfile: "C:\\Users\\me",
      searchPath: "C:\\Program Files\\nodejs;C:\\Users\\me\\AppData\\Roaming\\npm;c:\\users\\ME\\.local\\bin",
    });
    assert.ok(policy.filesystem.allowRead.includes("C:/Program Files/nodejs"));
    for (const userInstall of ["C:/Users/me/AppData/Roaming/npm", "c:/users/ME/.local/bin"]) {
      assert.ok(!policy.filesystem.allowRead.some((entry) => entry.toLowerCase() === userInstall.toLowerCase()), userInstall);
    }
    // The root itself may sit in the profile, and stays readable.
    assert.ok(policy.filesystem.allowRead.includes("C:/Users/me/work/app"));
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
    // The entries themselves (not Git's whole installation): each allowed tree costs launch time.
    assert.deepEqual(policy.filesystem.allowRead, ["C:/Windows", "C:/Program Files/Git/bin", "D:/tools", "C:/Users/me/work/app", "C:/Users/me/AppData/Local/Temp/pi-outpost-terminal-1"]);
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
      { root, tmp, shell: "/bin/bash", platform: "linux" },
    );
    assert.deepEqual(env, {
      PATH: "/usr/bin", LANG: "fr_FR.UTF-8", LC_ALL: "C", TERM: "xterm-256color", SHELL: "/bin/bash", HOME: root, TMPDIR: tmp,
      // npm's cache in the private temp: the profile's is out of reach.
      npm_config_cache: path.join(tmp, "npm-cache"),
      // The shell's history too, or it lands in the user's project.
      HISTFILE: path.join(tmp, ".shell_history"),
      ZDOTDIR: tmp,
    });
  });
});

describe("confinedEnvironment on Windows", () => {
  test("the system's locations pass (the runner needs them), credentials still do not", () => {
    const env = confinedEnvironment(
      { Path: "C:\\Windows", PATH: "C:\\Windows", SystemRoot: "C:\\Windows", ProgramData: "C:\\ProgramData", ComSpec: "C:\\Windows\\system32\\cmd.exe", OPENAI_API_KEY: "sk-secret", APPDATA: "C:\\Users\\server\\AppData\\Roaming" },
      { root: "C:\\work\\app", tmp: "C:\\tmp\\t1", shell: "cmd.exe", platform: "win32" },
    );
    assert.equal(env.ProgramData, "C:\\ProgramData");
    assert.equal(env.SystemRoot, "C:\\Windows");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.APPDATA, undefined, "the server user's profile is not the shell's");
    // The profile Windows and PowerShell write under is the private temp, never the project.
    assert.equal(env.USERPROFILE, "C:\\tmp\\t1");
    assert.equal(env.HOME, "C:\\work\\app");
    assert.equal(env.TEMP, "C:\\tmp\\t1");
  });
});

describe("prepareConfinedTerminal", () => {
  test("writes the policy owner-only into a private directory that dispose removes", async () => {
    // The Linux policy: Windows' writes its paths with "/", which this lookup does not.
    const files = await prepareConfinedTerminal((dir) => terminalPolicy({ ...linux, root, allowWrite: true, tmp: dir }));
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

describe("runnerKind", () => {
  test("MXC's executor is known by its name, anything else is landstrip", () => {
    assert.equal(runnerKind("C:\\mxc\\bin\\x64\\wxc-exec.exe"), "mxc");
    assert.equal(runnerKind("C:/mxc/WXC-EXEC.EXE"), "mxc");
    assert.equal(runnerKind("/opt/mxc/wxc-exec"), "mxc");
    assert.equal(runnerKind("/opt/landstrip/bin/landstrip"), "landstrip");
    assert.equal(runnerKind("C:\\tools\\wxc-exec-wrapper.exe"), "landstrip");
  });

  // openlore: scenario=MxcNamesTheLinuxExecutor spec=sandbox-runner-bash
  test("MxcNamesTheLinuxExecutor: a path ending in lxc-exec is MXC on Linux, and only that name", () => {
    const shipped = "/opt/app/node_modules/@microsoft/mxc-sdk/bin/x64/lxc-exec";
    assert.equal(runnerKind(shipped), "mxc");
    assert.ok(isLinuxMxc(shipped));
    assert.ok(!isLinuxMxc("C:\\mxc\\bin\\x64\\wxc-exec.exe"));
    assert.equal(runnerKind("/opt/tools/lxc-exec-wrapper"), "landstrip");
    assert.equal(runnerKind("/opt/tools/LXC-EXEC"), "landstrip", "Linux names are case-sensitive");
  });

  // openlore: scenario=MxcNamesTheMacOsExecutor spec=sandbox-runner-bash
  test("MxcNamesTheMacOsExecutor: a path ending in mxc-exec-mac is MXC, and only that name", () => {
    const shipped = "/opt/app/node_modules/@microsoft/mxc-sdk/bin/arm64/mxc-exec-mac";
    assert.equal(runnerKind(shipped), "mxc");
    assert.ok(isMacMxc(shipped));
    assert.ok(!isLinuxMxc(shipped));
    assert.ok(!isMacMxc("/opt/app/node_modules/@microsoft/mxc-sdk/bin/x64/lxc-exec"));
    assert.equal(runnerKind("/opt/tools/mxc-exec-mac-wrapper"), "landstrip");
  });
});

describe("checkRunner with MXC's macOS executor", () => {
  async function withExecutor(run: (runner: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(path.join(tmpdir(), "mxc-mac-runner-"));
    const runner = path.join(dir, "mxc-exec-mac");
    await writeFile(runner, "", { mode: 0o755 });
    try {
      await run(runner);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("the check runs one confined /usr/bin/true under Seatbelt, network open, and passes when it does", async () => {
    await withExecutor(async (runner) => {
      let request: Record<string, unknown> | undefined;
      const ok = await checkRunner(runner, async (_file, args) => {
        request = JSON.parse(await readFile(args[0], "utf8"));
        return { stdout: "", stderr: "" };
      }, "darwin");
      assert.deepEqual(ok, { ok: true });
      assert.equal(request?.containment, "seatbelt");
      assert.equal((request?.process as { commandLine: string }).commandLine, "/usr/bin/true");
      assert.deepEqual(request?.network, { egress: { default: "allow" } });
    });
  });

  test("MXC's own message is the reason; elsewhere than macOS, refused", async () => {
    await withExecutor(async (runner) => {
      const said = "Seatbelt: sandbox_init failed: profile rejected";
      const refused = await checkRunner(runner, async () => {
        throw Object.assign(new Error("Command failed"), { stdout: `${said}{"error":{"code":"backend_error","message":"${said}"}}`, stderr: "" });
      }, "darwin");
      assert.ok(!refused.ok && refused.reason === `MXC cannot confine commands on this host: ${said}`, !refused.ok ? refused.reason : "");
      const linuxHost = await checkRunner(runner, async () => ({ stdout: "", stderr: "" }), "linux");
      assert.ok(!linuxHost.ok && /macOS only/.test(linuxHost.reason));
    });
  });
});

describe("checkRunner with MXC's Linux executor", () => {
  async function withExecutor(run: (runner: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(path.join(tmpdir(), "mxc-linux-runner-"));
    const runner = path.join(dir, "lxc-exec");
    await writeFile(runner, "", { mode: 0o755 });
    try {
      await run(runner);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("the check runs one confined /bin/true in Bubblewrap, network open, and passes when it does", async () => {
    await withExecutor(async (runner) => {
      let request: Record<string, unknown> | undefined;
      const ok = await checkRunner(runner, async (_file, args) => {
        assert.equal(args.length, 1, "the request file alone");
        request = JSON.parse(await readFile(args[0], "utf8"));
        return { stdout: "", stderr: "" };
      }, "linux");
      assert.deepEqual(ok, { ok: true });
      assert.equal(request?.containment, "bubblewrap");
      assert.equal((request?.process as { commandLine: string }).commandLine, "/bin/true");
      assert.deepEqual(request?.network, { egress: { default: "allow" } }, "the most demanding shape: a host that runs it runs the proxy too");
    });
  });

  // openlore: scenario=AContainerWithoutNamespacesRefusesWithTheReason spec=sandbox-runner-bash
  test("AContainerWithoutNamespacesRefusesWithTheReason: MXC's own message is the reason; elsewhere than Linux, refused", async () => {
    await withExecutor(async (runner) => {
      const said =
        "Bubblewrap: network.egress requires unprivileged user and network namespaces, which this host refused (unshare --user --net exited with exit status: 1).";
      const refused = await checkRunner(runner, async () => {
        throw Object.assign(new Error("Command failed"), { stdout: `${said}{"error":{"code":"backend_error","message":"${said}"}}`, stderr: "" });
      }, "linux");
      assert.ok(!refused.ok && refused.reason === `MXC cannot confine commands on this host: ${said}`, !refused.ok ? refused.reason : "");
      const windows = await checkRunner(runner, async () => ({ stdout: "", stderr: "" }), "win32");
      assert.ok(!windows.ok && /Linux only/.test(windows.reason));
    });
  });

  test("MXC's error object is read after its human line, and plain text passes through", () => {
    assert.equal(mxcErrorMessage('Something.{"error":{"code":"x","message":"the reason"}}'), "the reason");
    assert.equal(mxcErrorMessage("bwrap: No permissions to create new namespace\n"), "bwrap: No permissions to create new namespace");
  });
});

describe("mxcLinuxConfig", () => {
  const lroot = "/work/app";
  const ltmp = "/tmp/pi-outpost-bash-1";
  const present = new Set(["/usr", "/etc", "/lib", "/lib64", "/bin", "/sbin", "/opt/node"]);
  const base = {
    root: lroot,
    allowWrite: true,
    tmp: ltmp,
    shell: "/bin/bash",
    shellArgs: ["/tmp/pi-outpost-bash-1/command.sh"],
    cwd: lroot,
    env: { PATH: "/opt/node/bin:/usr/bin:/bin", HOME: lroot },
    searchPath: "/opt/node/bin:/usr/bin:/bin:relative/bin",
    agentDir: "/home/node/.pi/agent",
    configFile: "/work/app/pi-outpost.config.json",
    readOnlyFiles: ["/home/node/.gitconfig"],
    exists: (file: string) => present.has(file),
  };

  // openlore: scenario=OnLinuxWithoutAnAllowlistTheNetworkIsOpen spec=sandbox-runner-bash
  test("OnLinuxWithoutAnAllowlistTheNetworkIsOpen: Bubblewrap, the root and the temp writable, the system read-only, secrets denied", () => {
    const config = mxcLinuxConfig(base);
    assert.equal(config.containment, "bubblewrap");
    assert.deepEqual(config.filesystem.readwritePaths, [lroot, ltmp]);
    // Only trees this host has; a search path's installation; the shell's folder; git's identity.
    assert.deepEqual(config.filesystem.readonlyPaths, ["/usr", "/etc", "/lib", "/lib64", "/bin", "/sbin", "/opt/node", "/home/node/.gitconfig"]);
    assert.deepEqual(config.filesystem.deniedPaths, [base.agentDir, base.configFile]);
    assert.equal(config.process.commandLine, "/bin/bash /tmp/pi-outpost-bash-1/command.sh");
    assert.deepEqual(config.process.env, ["PATH=/opt/node/bin:/usr/bin:/bin", `HOME=${lroot}`]);
    assert.deepEqual(config.network, { egress: { default: "allow" } });
    assert.equal(config.runtimeConfig, undefined);
  });

  test("a narrower writable zone sits inside the read-only root; without write, only the temp", () => {
    const zoned = mxcLinuxConfig({ ...base, writableRoot: `${lroot}/out` });
    assert.deepEqual(zoned.filesystem.readwritePaths, [`${lroot}/out`, ltmp]);
    assert.ok(zoned.filesystem.readonlyPaths.includes(lroot));
    const readOnly = mxcLinuxConfig({ ...base, allowWrite: false });
    assert.deepEqual(readOnly.filesystem.readwritePaths, [ltmp]);
    assert.ok(readOnly.filesystem.readonlyPaths.includes(lroot));
  });

  test("under allowedHosts: outbound and inbound denied, the proxy the only way out", () => {
    const config = mxcLinuxConfig({ ...base, networkProxy: "http://127.0.0.1:4567" });
    assert.deepEqual(config.network, { egress: { default: "deny" }, ingress: { default: "deny" } }, "Bubblewrap refuses inbound beside a proxy");
    assert.deepEqual(config.runtimeConfig, { networkProxy: "http://127.0.0.1:4567" });
  });

  test("arguments are quoted for a POSIX command line", () => {
    assert.equal(quotePosixArgument("/bin/bash"), "/bin/bash");
    assert.equal(quotePosixArgument("it's here"), `'it'\\''s here'`);
    assert.equal(mxcLinuxConfig({ ...base, shellArgs: ["-c", "echo $HOME; ls"] }).process.commandLine, `/bin/bash -c 'echo $HOME; ls'`);
  });
});

describe("mxcMacConfig", () => {
  const mroot = "/Users/me/app";
  const mtmp = "/var/folders/xy/T/pi-outpost-bash-1";
  const developerDir = "/Applications/Xcode.app/Contents/Developer";
  const present = new Set(["/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/opt/homebrew", "/Applications/Xcode.app", `${developerDir}/usr/bin/git`]);
  // As Seatbelt sees them: /var is a symlink to /private/var.
  const realPath = (file: string) => (file.startsWith("/var/") ? `/private${file}` : file);
  const base = {
    root: mroot,
    allowWrite: true,
    tmp: mtmp,
    shell: "/bin/bash",
    shellArgs: [`${mtmp}/command.sh`],
    cwd: mroot,
    env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: mroot },
    searchPath: "/opt/homebrew/bin:/usr/bin:/bin",
    agentDir: "/Users/me/.pi/agent",
    configFile: "/Users/me/app/pi-outpost.config.json",
    readOnlyFiles: ["/Users/me/.gitconfig"],
    developerDir,
    realPath,
    exists: (file: string) => present.has(file),
  };

  // openlore: scenario=OnMacOsWithoutAnAllowlistTheNetworkIsOpen spec=sandbox-runner-bash
  test("OnMacOsWithoutAnAllowlistTheNetworkIsOpen: Seatbelt, real paths, the developer tools readable, secrets denied", () => {
    const config = mxcMacConfig(base);
    assert.equal(config.containment, "seatbelt");
    assert.deepEqual(config.filesystem.readwritePaths, [mroot, `/private${mtmp}`], "the temp as Seatbelt matches it");
    assert.deepEqual(config.filesystem.readonlyPaths, ["/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/opt/homebrew", "/Applications/Xcode.app", "/Users/me/.gitconfig"]);
    assert.deepEqual(config.filesystem.deniedPaths, [base.agentDir, base.configFile]);
    assert.deepEqual(config.network, { egress: { default: "allow" } });
    assert.equal(config.runtimeConfig, undefined);
  });

  // openlore: scenario=OnMacOsGitAnswersQuietly spec=sandbox-runner-bash
  test("the developer directory's git comes before Apple's xcrun shim on the search path", () => {
    assert.ok(mxcMacConfig(base).process.env.includes(`PATH=${developerDir}/usr/bin:/opt/homebrew/bin:/usr/bin:/bin`));
    const without = mxcMacConfig({ ...base, developerDir: null });
    assert.ok(without.process.env.includes("PATH=/opt/homebrew/bin:/usr/bin:/bin"), "no developer tools: the search path as given");
    const clt = "/Library/Developer/CommandLineTools";
    const tools = mxcMacConfig({ ...base, developerDir: clt, exists: (file) => present.has(file) || file === `${clt}/usr/bin/git` || file === clt });
    assert.ok(tools.process.env.includes(`PATH=${clt}/usr/bin:/opt/homebrew/bin:/usr/bin:/bin`));
  });

  test("a narrower writable zone sits inside the read-only root; under allowedHosts, the proxy the only way out", () => {
    const zoned = mxcMacConfig({ ...base, writableRoot: `${mroot}/out` });
    assert.deepEqual(zoned.filesystem.readwritePaths, [`${mroot}/out`, `/private${mtmp}`]);
    assert.ok(zoned.filesystem.readonlyPaths.includes(mroot));
    const proxied = mxcMacConfig({ ...base, networkProxy: "http://127.0.0.1:4567" });
    assert.deepEqual(proxied.network, { egress: { default: "deny" }, ingress: { default: "deny" } });
    assert.deepEqual(proxied.runtimeConfig, { networkProxy: "http://127.0.0.1:4567" });
  });

  test("mxcPosixConfig picks the backend by the executor's name", () => {
    assert.equal(mxcPosixConfig("/x/bin/arm64/mxc-exec-mac", base).containment, "seatbelt");
    assert.equal(mxcPosixConfig("/x/bin/x64/lxc-exec", base).containment, "bubblewrap");
  });
});

describe("seatbeltPolicy", () => {
  const sroot = "/Users/me/app";
  const stmp = "/private/var/folders/xy/T/pi-outpost-bash-1";
  const developerDir = "/Applications/Xcode.app/Contents/Developer";
  const present = new Set(["/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/Applications/Xcode.app", `${developerDir}/usr/bin/git`]);
  const base = {
    root: sroot,
    allowWrite: true,
    tmp: stmp,
    shell: "/bin/bash",
    shellArgs: [`${stmp}/command.sh`],
    cwd: sroot,
    env: { PATH: "/usr/bin:/bin", HOME: sroot },
    searchPath: "/usr/bin:/bin",
    agentDir: "/Users/me/.pi/agent",
    configFile: "/Users/me/app/pi-outpost.config.json",
    developerDir,
    realPath: (file: string) => file,
    exists: (file: string) => present.has(file),
  };

  // openlore: scenario=UnderSeatbeltWithoutAnAllowlistTheNetworkIsOpen spec=sandbox-runner-bash
  test("MXC's shape: deny by default, the paths of mxcMacConfig, open network with the loopback closed, denied paths last", () => {
    const { seatbelt, env } = seatbeltPolicy(base);
    const lines = seatbelt.split("\n");
    assert.deepEqual(lines.slice(0, 2), ["(version 1)", "(deny default)"]);
    assert.ok(lines.includes("(allow signal (target same-sandbox))"), "a signal may reach only the sandbox's own processes");
    assert.ok(seatbelt.includes(`(allow file-read* file-write* (subpath "${sroot}"))`));
    assert.ok(seatbelt.includes(`(allow file-read* file-write* (subpath "${stmp}"))`));
    assert.ok(seatbelt.includes('(subpath "/Applications/Xcode.app")'), "the developer tools are readable");
    assert.ok(lines.includes("(allow network-outbound)"));
    assert.ok(lines.includes('(deny network-outbound (remote ip "localhost:*"))'), "the server and local services stay out of reach");
    const denied = lines.findIndex((line) => line.startsWith("(deny file-read* file-read-metadata file-write*"));
    assert.equal(denied, lines.length - 4, "the denied paths come last, so they override every allow");
    assert.ok(seatbelt.includes(`(subpath "${base.agentDir}")`) && seatbelt.includes(`(subpath "${base.configFile}")`));
    assert.equal(env.PATH, `${developerDir}/usr/bin:/usr/bin:/bin`, "the developer tools' git first, as under MXC");
    assert.equal(env.HTTPS_PROXY, undefined);
  });

  test("a writable zone inside the read-only root comes after it, so it wins", () => {
    const { seatbelt } = seatbeltPolicy({ ...base, writableRoot: `${sroot}/out` });
    const readOnly = seatbelt.indexOf(`(subpath "${sroot}")`);
    const zone = seatbelt.indexOf(`(allow file-read* file-write* (subpath "${sroot}/out"))`);
    assert.ok(readOnly > 0 && zone > readOnly, seatbelt);
    assert.ok(!seatbelt.includes(`(allow file-read* file-write* (subpath "${sroot}"))`));
  });

  test("under allowedHosts: the proxy's port alone, and the proxy's variables set for the command", () => {
    const { seatbelt, env } = seatbeltPolicy({ ...base, networkProxy: "http://127.0.0.1:4567" });
    assert.ok(seatbelt.includes('(allow network-outbound (remote ip "localhost:4567"))'), seatbelt);
    assert.ok(!seatbelt.includes("(allow network-outbound)\n"), "no open outbound rule");
    for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) {
      assert.equal(env[name], "http://127.0.0.1:4567", name);
    }
  });

  test("paths are quoted for SBPL: a quote or a backslash cannot end the string", () => {
    assert.equal(sbplString('/Users/me/a "b"\\c'), '"/Users/me/a \\"b\\"\\\\c"');
    const { seatbelt } = seatbeltPolicy({ ...base, root: '/Users/me/odd")(allow default' });
    assert.ok(!seatbelt.includes('odd")(allow default"'), "the path broke out of its string");
    assert.ok(seatbelt.includes('(subpath "/Users/me/odd\\")(allow default")'));
  });
});

describe("checkRunner with macOS' sandbox-exec", () => {
  test("SeatbeltNamesTheSystemRunner: sandbox-exec is the seatbelt kind; the check runs /usr/bin/true under a profile, and is refused off macOS", async () => {
    assert.equal(runnerKind("/usr/bin/sandbox-exec"), "seatbelt");
    assert.equal(runnerKind("C:\\tools\\sandbox-exec"), "seatbelt", "a Windows path is split too (the check refuses it there)");
    assert.equal(runnerKind("/opt/tools/sandbox-exec-wrapper"), "landstrip");
    const dir = await mkdtemp(path.join(tmpdir(), "seatbelt-runner-"));
    const runner = path.join(dir, "sandbox-exec");
    await writeFile(runner, "", { mode: 0o755 });
    try {
      let seen: string[] = [];
      let profile = "";
      const ok = await checkRunner(runner, async (_file, args) => {
        seen = args;
        profile = await readFile(args[1], "utf8");
        return { stdout: "", stderr: "" };
      }, "darwin");
      assert.deepEqual(ok, { ok: true });
      assert.equal(seen[0], "-f");
      assert.equal(seen[2], "/usr/bin/true");
      assert.match(profile, /^\(version 1\)\n\(deny default\)/);
      const refused = await checkRunner(runner, async () => {
        throw Object.assign(new Error("Command failed"), { stderr: "sandbox-exec: invalid profile", stdout: "" });
      }, "darwin");
      assert.ok(!refused.ok && refused.reason === "Seatbelt cannot confine commands on this host: sandbox-exec: invalid profile", !refused.ok ? refused.reason : "");
      const linuxHost = await checkRunner(runner, async () => ({ stdout: "", stderr: "" }), "linux");
      assert.ok(!linuxHost.ok && /macOS only/.test(linuxHost.reason));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("checkRunner with MXC's executor", () => {
  // The executor's file must exist to be checked at all: an empty one under MXC's name.
  async function withExecutor(run: (runner: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(path.join(tmpdir(), "mxc-runner-"));
    const runner = path.join(dir, "wxc-exec.exe");
    await writeFile(runner, "", { mode: 0o755 });
    try {
      await run(runner);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const probe = (tier: string, denyPaths = true) => async (_file: string, args: string[]) => {
    assert.deepEqual(args, ["--probe"], "the self-check is the probe, which spawns no sandbox");
    return { stdout: JSON.stringify({ tier, probes: { baseContainerSupportsDenyPaths: denyPaths } }), stderr: "" };
  };

  // openlore: scenario=AnMxcRunnerBelowTier1MeansNoTerminal spec=terminal
  test("only tier 1 is usable: a lower tier would stamp ACLs over the readable drive", async () => {
    await withExecutor(async (runner) => {
      assert.deepEqual(await checkRunner(runner, probe("base-container"), "win32"), { ok: true });
      const tier3 = await checkRunner(runner, probe("appcontainer-dacl"), "win32");
      assert.ok(!tier3.ok && /appcontainer-dacl/.test(tier3.reason) && /base-container/.test(tier3.reason), !tier3.ok ? tier3.reason : "");
      const noDeny = await checkRunner(runner, probe("base-container", false), "win32");
      assert.ok(!noDeny.ok && /deny paths/.test(noDeny.reason));
    });
  });

  // openlore: scenario=AnOldWindowsBuildRefusesTheShell spec=sandbox-defaults
  test("AnOldWindowsBuildRefusesTheShell: below MXC's table, the reason names the build and the update to install", async () => {
    await withExecutor(async (runner) => {
      const host = (build: string, ubr: number) => async (file: string, args: string[]) => {
        if (args[0] === "--probe") return { stdout: JSON.stringify({ tier: "appcontainer-dacl", probes: {} }), stderr: "" };
        assert.equal(file, "reg");
        const value = args.at(-1);
        return {
          stdout: value === "UBR" ? `    UBR    REG_DWORD    0x${ubr.toString(16)}\r\n` : `    CurrentBuild    REG_SZ    ${build}\r\n`,
          stderr: "",
        };
      };
      const old = await checkRunner(runner, host("26100", 8000), "win32");
      assert.ok(!old.ok);
      assert.match(old.reason, /Windows build 26100\.8000; MXC's process container needs 26100\.9278: install the August 2026 cumulative update \(KB5120998\)/);
      const older = await checkRunner(runner, host("22631", 4000), "win32");
      assert.ok(!older.ok && /22631\.4000; MXC's process container needs Windows 11 24H2/.test(older.reason));
      const unreadable = await checkRunner(runner, async (_file: string, args: string[]) => {
        if (args[0] === "--probe") return { stdout: JSON.stringify({ tier: "appcontainer-dacl" }), stderr: "" };
        throw new Error("reg is not there");
      }, "win32");
      assert.ok(!unreadable.ok && /appcontainer-dacl/.test(unreadable.reason) && !/Windows build/.test(unreadable.reason));
    });
  });

  test("windowsBuildAdvice: each release's first supported build, and nothing to install at or above it", () => {
    assert.match(windowsBuildAdvice("26200", 9000), /26200\.9278: install the August 2026/);
    assert.match(windowsBuildAdvice("26300", 9500), /26300\.9550: install the September 2026 cumulative update \(KB5124010\)/);
    assert.match(windowsBuildAdvice("28000", 2000), /28000\.2804: install the August 2026 cumulative update \(KB5120996\)/);
    assert.equal(windowsBuildAdvice("26100", 9711), "This machine is Windows build 26100.9711");
    assert.equal(windowsBuildAdvice("29000", 1), "This machine is Windows build 29000.1");
  });

  test("anywhere but Windows, or a probe that fails or says nothing usable, is a reason", async () => {
    await withExecutor(async (runner) => {
      const linux = await checkRunner(runner, probe("base-container"), "linux");
      assert.ok(!linux.ok && /Windows only/.test(linux.reason));
      const failed = await checkRunner(runner, async () => {
        throw Object.assign(new Error("Command failed"), { stderr: "processmodel.dll missing" });
      }, "win32");
      assert.ok(!failed.ok && /processmodel\.dll missing/.test(failed.reason));
      const garbled = await checkRunner(runner, async () => ({ stdout: "not json", stderr: "" }), "win32");
      assert.ok(!garbled.ok && /not JSON/.test(garbled.reason));
    });
  });
});

describe("mxcTerminalConfig", () => {
  const wroot = "C:\\Users\\me\\work\\app";
  const wtmp = "C:\\Users\\me\\AppData\\Local\\Temp\\pi-outpost-terminal-1";
  const base = {
    root: wroot,
    allowWrite: true,
    tmp: wtmp,
    shell: "C:\\Users\\me\\tools\\sh.exe",
    shellArgs: [],
    cwd: wroot,
    env: { PATH: "C:\\Windows", HOME: wroot },
    siblings: ["C:\\Users\\me\\.ssh", "C:\\Users\\me\\tools", "C:\\Users\\me\\AppData", "C:\\Users\\other", "C:\\mxc-lab"],
    agentDir: "C:\\Users\\me\\.pi\\agent",
    configFile: "C:\\Users\\me\\work\\app\\pi-outpost.config.json",
  };

  // openlore: scenario=AToolInstalledForTheUserRuns spec=sandbox-runner-bash
  test("AToolInstalledForTheUserRuns: the search path's folders are readable, but never one that would undo the sandbox", () => {
    const python = "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python314";
    const searchPath = [
      `${python}\\Scripts\\`,
      python,
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps",
      "C:\\Program Files\\nodejs\\",
      // Too broad: they would open the profile, or the folder holding the agent directory.
      "C:\\Users\\me",
      "c:\\users",
      "C:\\Users\\me\\.pi",
      "C:\\",
      "relative\\bin",
      "",
    ].join(";");
    const config = mxcTerminalConfig({ ...base, searchPath, home: "C:\\Users\\me" });
    for (const entry of [`${python}\\Scripts`, python, "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps", "C:\\Program Files\\nodejs"]) {
      assert.ok(config.filesystem.readonlyPaths.includes(entry), `${entry} not readable: ${config.filesystem.readonlyPaths.join(", ")}`);
    }
    for (const entry of ["C:\\Users\\me", "c:\\users", "C:\\Users\\me\\.pi", "relative\\bin"]) {
      assert.ok(!config.filesystem.readonlyPaths.includes(entry), `${entry} made readable`);
    }
    // The secrets stay denied, and a granted tool folder is not also denied as a sibling.
    assert.ok(config.filesystem.deniedPaths.includes(base.agentDir));
    assert.deepEqual(readableSearchEntries(undefined, {}), []);
  });

  test("the drive is readable for git, everything beside the root denied, secrets denied by name", () => {
    const config = mxcTerminalConfig({ ...base, writableRoot: wroot + "\\out" });
    assert.deepEqual(config.filesystem.readwritePaths, [wroot + "\\out", wtmp]);
    assert.deepEqual(config.filesystem.readonlyPaths, ["C:\\", wroot, "C:\\Users\\me\\tools"]);
    // The shell's own folder is allowed: denying it as well would leave the winner to the sandbox.
    assert.deepEqual(config.filesystem.deniedPaths, ["C:\\Users\\me\\.ssh", "C:\\Users\\me\\AppData", "C:\\Users\\other", "C:\\mxc-lab", base.agentDir, base.configFile]);
    assert.equal(config.containment, "processcontainer");
    assert.equal(config.ui.disable, false, "PowerShell and git need Win32k");
    assert.deepEqual(config.network, { egress: { default: "allow" } }, "the terminal keeps the network, as the user's shell does");
  });

  // openlore: scenario=TheRequestKeepsTheDesktopOutOfReach spec=terminal
  test("TheRequestKeepsTheDesktopOutOfReach: no clipboard and no input injection are asked for, in every case", () => {
    for (const config of [mxcTerminalConfig(base), mxcTerminalConfig({ ...base, allowWrite: false }), mxcTerminalConfig({ ...base, writableRoot: wroot + "\\out" })]) {
      assert.deepEqual(config.ui, { disable: false, clipboard: "none", injection: false });
    }
  });

  // openlore: scenario=NoAllowlistKeepsTheNetwork spec=sandbox-runner-bash
  test("NoAllowlistKeepsTheNetwork: without a proxy the network is open and none is set; with one, closed but for it", () => {
    const open = mxcTerminalConfig(base);
    assert.deepEqual(open.network, { egress: { default: "allow" } });
    assert.equal(open.runtimeConfig, undefined);
    const closed = mxcTerminalConfig({ ...base, networkProxy: "http://127.0.0.1:4567" });
    assert.deepEqual(closed.network, { egress: { default: "deny" }, ingress: { default: "allow", hostLoopback: "allow" } });
    assert.deepEqual(closed.runtimeConfig, { networkProxy: "http://127.0.0.1:4567" });
    assert.deepEqual(closed.filesystem, open.filesystem, "the file limits are the same either way");
  });

  test("the whole root writable, or nothing but the temp when writes are off", () => {
    const writable = mxcTerminalConfig(base);
    assert.deepEqual(writable.filesystem.readwritePaths, [wroot, wtmp]);
    assert.ok(!writable.filesystem.readonlyPaths.includes(wroot), "not both writable and read-only");
    const readOnly = mxcTerminalConfig({ ...base, allowWrite: false });
    assert.deepEqual(readOnly.filesystem.readwritePaths, [wtmp]);
    assert.ok(readOnly.filesystem.readonlyPaths.includes(wroot));
  });

  // openlore: scenario=KeysDoNotReachTheShell spec=terminal
  test("the request carries the command line, the start directory and only the given environment", () => {
    const config = mxcTerminalConfig({ ...base, shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", shellArgs: ["-NoLogo", "-Command", 'echo "hi"'] });
    assert.equal(config.process.commandLine, '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -Command "echo \\"hi\\""');
    assert.equal(config.process.cwd, wroot);
    assert.deepEqual(config.process.env, ["PATH=C:\\Windows", `HOME=${wroot}`]);
  });
});

describe("git's identity inside", () => {
  // openlore: scenario=GitAppliesTheGlobalIgnoreQuietly spec=terminal
  test("GitAppliesTheGlobalIgnoreQuietly: the files .gitconfig names in [core] are readable too, existing ones only", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "git-home-"));
    try {
      const gitConfig = path.join(home, ".gitconfig");
      const ignore = path.join(home, ".gitignore_global");
      const attributes = path.join(home, "git", "attributes");
      await mkdir(path.join(home, "git"));
      await writeFile(ignore, "*.log\n");
      await writeFile(attributes, "* text=auto\n");
      await writeFile(
        gitConfig,
        [
          "[user]",
          "\texcludesfile = /not/core/ignored",
          "[Core]",
          "\tExcludesFile = ~/.gitignore_global ; a comment",
          `\tattributesfile = "${attributes}"`,
          "[core \"sub\"]",
          "\texcludesfile = /also/not/core",
          "[core]",
          "\tattributesFile = ~/missing-file",
          "",
        ].join("\r\n"),
      );
      assert.deepEqual(gitReadOnlyFiles(gitConfig, home), [gitConfig, ignore, attributes]);
      assert.deepEqual(gitReadOnlyFiles(undefined, home), []);
      assert.deepEqual(gitReadOnlyFiles(path.join(home, "absent"), home), [path.join(home, "absent")], "an unreadable file is passed as it was");
      // In a policy: the files, read-only; never their folder.
      const policy = terminalPolicy({ ...linux, root, allowWrite: true, tmp, readOnlyFiles: gitReadOnlyFiles(gitConfig, home) });
      assert.ok(policy.filesystem.allowRead.includes(ignore));
      assert.ok(!policy.filesystem.allowRead.includes(home));
      assert.ok(!policy.filesystem.allowWrite.includes(ignore), "read-only");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  // openlore: scenario=GitKnowsWhoCommits spec=terminal
  test("the user's .gitconfig is passed as GIT_CONFIG_GLOBAL and readable on its own, in every policy", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "git-home-"));
    try {
      assert.equal(userGitConfig(home), undefined, "no file, nothing to pass");
      await writeFile(path.join(home, ".gitconfig"), "[user]\n\tname = Me\n");
      const gitConfig = userGitConfig(home)!;
      assert.equal(gitConfig, path.join(home, ".gitconfig"));

      const env = confinedEnvironment({}, { root, tmp, shell: "/bin/bash", platform: "linux", gitConfig });
      assert.equal(env.GIT_CONFIG_GLOBAL, gitConfig);
      assert.equal(confinedEnvironment({}, { root, tmp, shell: "/bin/bash", platform: "linux" }).GIT_CONFIG_GLOBAL, undefined);

      // landstrip, Linux: the file is allowed back, not its folder.
      const linuxPolicy = terminalPolicy({ ...linux, root, allowWrite: true, tmp, readOnlyFiles: ["/home/me/.gitconfig"] });
      assert.ok(linuxPolicy.filesystem.allowRead.includes("/home/me/.gitconfig"));
      assert.ok(!linuxPolicy.filesystem.allowRead.includes("/home/me"));
      assert.ok(!linuxPolicy.filesystem.allowWrite.includes("/home/me/.gitconfig"), "read-only");
      // MXC: read-only, and taken out of the deny list that names it as a sibling.
      const mxc = mxcTerminalConfig({
        root: "C:\\Users\\me\\work\\app", allowWrite: true, tmp: "C:\\t", shell: "cmd.exe", shellArgs: [], cwd: "C:\\Users\\me\\work\\app", env: {},
        siblings: ["C:\\Users\\me\\.gitconfig", "C:\\Users\\me\\.ssh"], readOnlyFiles: ["C:\\Users\\me\\.gitconfig"],
      });
      assert.ok(mxc.filesystem.readonlyPaths.includes("C:\\Users\\me\\.gitconfig"));
      assert.ok(!mxc.filesystem.readwritePaths.includes("C:\\Users\\me\\.gitconfig"), "read-only");
      assert.deepEqual(mxc.filesystem.deniedPaths, ["C:\\Users\\me\\.ssh"], "the rest of the home stays denied");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("quoteWindowsArgument", () => {
  test("quotes what CommandLineToArgvW would split, doubling backslashes only where they escape", () => {
    assert.equal(quoteWindowsArgument("plain"), "plain");
    assert.equal(quoteWindowsArgument(""), '""');
    assert.equal(quoteWindowsArgument("a b"), '"a b"');
    assert.equal(quoteWindowsArgument('say "x"'), '"say \\"x\\""');
    assert.equal(quoteWindowsArgument("C:\\dir with space\\"), '"C:\\dir with space\\\\"');
    assert.equal(quoteWindowsArgument('a\\"b'), '"a\\\\\\"b"');
  });
});

describe("siblingsToDeny", () => {
  // A walk of the real drive is the Windows real-runner test's job; here a layout under a
  // temp directory stands in, and the path down to the root is what must stay out.
  test("everything beside the path to the root, not the path itself, nor links", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "siblings-"));
    try {
      const me = path.join(base, "users", "me");
      const root = path.join(me, "work", "app");
      await mkdir(root, { recursive: true });
      await mkdir(path.join(me, ".ssh"));
      await mkdir(path.join(base, "users", "other"));
      await writeFile(path.join(me, ".gitconfig"), "[user]");
      await mkdir(path.join(me, "work", "sibling-project"));
      // A junction on Windows, a symlink elsewhere: MXC rejects a policy naming one.
      await symlink(path.join(me, "work", "sibling-project"), path.join(me, "link"), "junction");
      const denied = siblingsToDeny(root).map((entry) => path.resolve(entry));
      for (const secret of [path.join(me, ".ssh"), path.join(base, "users", "other"), path.join(me, ".gitconfig"), path.join(me, "work", "sibling-project")]) {
        assert.ok(denied.includes(secret), `${secret} is denied`);
      }
      for (const onTheWay of [path.join(base, "users"), me, path.join(me, "work"), root]) {
        assert.ok(!denied.includes(onTheWay), `${onTheWay} is on the way down and stays`);
      }
      assert.ok(!denied.includes(path.join(me, "link")), "a link is never named");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("a FIFO beside the path is never opened: reading one blocks until a writer comes", { skip: process.platform === "win32" && "no FIFOs on Windows" }, async () => {
    const base = await mkdtemp(path.join(tmpdir(), "siblings-fifo-"));
    try {
      const root = path.join(base, "app");
      await mkdir(root);
      execFileSync("mkfifo", [path.join(base, "pipe")]);
      // Run in a child with a deadline: a regression blocks synchronously, and would
      // otherwise hang this whole test file — which is how it was found.
      const script = `import { siblingsToDeny } from ${JSON.stringify(pathToFileURL(path.resolve("src/terminalSandbox.ts")).href)}; console.log(JSON.stringify(siblingsToDeny(${JSON.stringify(root)})));`;
      const out = execFileSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], { timeout: 20_000, encoding: "utf8", env: envWithoutCoverageSink() });
      assert.ok(!JSON.parse(out).includes(path.join(base, "pipe")), "a FIFO was named, so it was opened");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

// openlore: scenario=AReadGrantDoesNotWrite spec=sandbox-approved-grants
describe("grants, in every policy", () => {
  const work = "/work/app";
  const beside = "/work/beside";
  const notes = "/work/notes";
  const grant = { grantedWrite: [beside], grantedRead: [notes] };
  const posix = {
    root: work,
    allowWrite: true,
    tmp: "/tmp/pi-outpost-bash-1",
    shell: "/bin/bash",
    shellArgs: ["/tmp/pi-outpost-bash-1/command.sh"],
    cwd: work,
    env: { PATH: "/usr/bin:/bin" },
    exists: () => true,
    realPath: (file: string) => file,
    developerDir: null,
  };
  const read = (fs: { readwritePaths: string[]; readonlyPaths: string[] }) => [...fs.readwritePaths, ...fs.readonlyPaths];

  test("landstrip: a write grant is readable and writable, a read grant readable only; none without a grant", () => {
    const policy = terminalPolicy({ ...linux, root: work, allowWrite: true, tmp, ...grant });
    assert.ok(policy.filesystem.allowWrite.includes(beside) && policy.filesystem.allowRead.includes(beside));
    assert.ok(policy.filesystem.allowRead.includes(notes) && !policy.filesystem.allowWrite.includes(notes));
    const plain = terminalPolicy({ ...linux, root: work, allowWrite: true, tmp });
    assert.ok(![...plain.filesystem.allowRead, ...plain.filesystem.allowWrite].some((p) => p === beside || p === notes));
  });

  test("landstrip on Windows: the same, with the grant's drive denied so reading stays an allowlist", () => {
    const policy = terminalPolicy({ platform: "win32", systemRoot: "C:\\Windows", root: "C:\\work\\app", allowWrite: true, tmp: "C:\\Temp\\t", grantedWrite: ["D:\\beside"], grantedRead: ["C:\\notes"] });
    assert.ok(policy.filesystem.allowWrite.includes("D:/beside") && policy.filesystem.allowRead.includes("D:/beside"));
    assert.ok(policy.filesystem.allowRead.includes("C:/notes") && !policy.filesystem.allowWrite.includes("C:/notes"));
    assert.ok(policy.filesystem.denyRead.includes("D:/"), "a granted drive is denied but for the grant");
  });

  test("a write grant holds with writing off: the user asked for it", () => {
    const policy = terminalPolicy({ ...linux, root: work, allowWrite: false, tmp, grantedWrite: [beside] });
    assert.ok(policy.filesystem.allowWrite.includes(beside) && !policy.filesystem.allowWrite.includes(work));
    assert.deepEqual(mxcLinuxConfig({ ...posix, allowWrite: false, grantedWrite: [beside] }).filesystem.readwritePaths, [beside, posix.tmp]);
  });

  test("MXC on Linux and macOS: the write grant read-write, the read grant read-only", () => {
    for (const config of [mxcLinuxConfig({ ...posix, ...grant }), mxcMacConfig({ ...posix, ...grant })]) {
      assert.ok(config.filesystem.readwritePaths.includes(beside), config.containment);
      assert.ok(config.filesystem.readonlyPaths.includes(notes) && !config.filesystem.readwritePaths.includes(notes), config.containment);
      assert.ok(!read(mxcLinuxConfig(posix).filesystem).includes(beside), "nothing without a grant");
    }
  });

  test("Seatbelt: the write grant gets file-write, the read grant file-read only, before the secrets' deny", () => {
    const { seatbelt } = seatbeltPolicy({ ...posix, ...grant, agentDir: "/srv/agent" });
    assert.ok(seatbelt.includes(`(allow file-read* file-write* (subpath "${beside}"))`), seatbelt);
    assert.ok(seatbelt.includes(`(subpath "${notes}")`) && !seatbelt.includes(`file-write* (subpath "${notes}")`));
    assert.ok(seatbelt.lastIndexOf("/srv/agent") > seatbelt.lastIndexOf(beside), "the agent directory's deny comes last and wins");
  });

  test("MXC on Windows: a grant beside the root is allowed over its denied sibling", () => {
    const wroot = "C:\\Users\\me\\work\\app";
    const config = mxcTerminalConfig({
      root: wroot,
      allowWrite: true,
      tmp: "C:\\Temp\\t",
      shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      shellArgs: [],
      cwd: wroot,
      env: {},
      siblings: ["C:\\Users\\me\\work\\beside", "C:\\Users\\me\\Documents"],
      grantedWrite: ["C:\\Users\\me\\work\\beside"],
      grantedRead: ["C:\\Users\\me\\Documents\\notes"],
    });
    assert.ok(config.filesystem.readwritePaths.includes("C:\\Users\\me\\work\\beside"));
    assert.ok(!config.filesystem.deniedPaths.includes("C:\\Users\\me\\work\\beside"), "a path both allowed and denied is never sent");
    assert.ok(config.filesystem.readonlyPaths.includes("C:\\Users\\me\\Documents\\notes"));
    // The rest of the sibling stays denied: the grant is more specific than the deny.
    assert.ok(config.filesystem.deniedPaths.includes("C:\\Users\\me\\Documents"));
  });
});
