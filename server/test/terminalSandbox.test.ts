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
  confinedEnvironment,
  mxcTerminalConfig,
  prepareConfinedTerminal,
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

  test("the drive is readable for git, everything beside the root denied, secrets denied by name", () => {
    const config = mxcTerminalConfig({ ...base, writableRoot: wroot + "\\out" });
    assert.deepEqual(config.filesystem.readwritePaths, [wroot + "\\out", wtmp]);
    assert.deepEqual(config.filesystem.readonlyPaths, ["C:\\", wroot, "C:\\Users\\me\\tools"]);
    // The shell's own folder is allowed: denying it as well would leave the winner to the sandbox.
    assert.deepEqual(config.filesystem.deniedPaths, ["C:\\Users\\me\\.ssh", "C:\\Users\\me\\AppData", "C:\\Users\\other", "C:\\mxc-lab", base.agentDir, base.configFile]);
    assert.equal(config.containment, "processcontainer");
    assert.deepEqual(config.ui, { disable: false }, "PowerShell and git need Win32k");
    assert.deepEqual(config.network, { egress: { default: "allow" } }, "the terminal keeps the network, as the user's shell does");
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
