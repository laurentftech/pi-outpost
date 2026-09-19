/**
 * Knowing which installation is running, and what the registry says about it.
 *
 * The detection rules are worth testing precisely because getting them wrong is
 * silent: an npx run mistaken for a global install would "upgrade" a cache
 * directory and report success, and a checkout mistaken for a package would
 * install a second copy elsewhere while the operator keeps running the first.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { OutpostUpdateNotice } from "@pi-outpost/shared";
import {
  CHECK_INTERVAL_MS,
  cachePath,
  currentEvidence,
  detectChannel,
  extractSingleVersion,
  fetchLatestVersion,
  isFresh,
  isNewer,
  npmCommand,
  npmExecutable,
  npmInstallInvocation,
  npmViewInvocation,
  readCache,
  runStartupUpdateNotice,
  runUpdateCommand,
  shouldCheckAtStartup,
  writeCache,
  type ChannelEvidence,
  type InstallChannel,
  type VersionLookup,
} from "../src/update.ts";

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-update-"));
  roots.push(root);
  return root;
}

const evidence = (over: Partial<ChannelEvidence> = {}): ChannelEvidence => ({
  version: "0.8.0",
  entryPath: "/usr/local/lib/node_modules/pi-outpost/dist/pi-outpost.mjs",
  execPath: "/usr/local/bin/node",
  isSea: false,
  globalRoot: "/usr/local/lib/node_modules",
  ...over,
});

describe("detectChannel", () => {
  test("a build-time version that was never substituted means a checkout", () => {
    // The one signal no path can fake, which is why it is consulted first.
    assert.equal(detectChannel(evidence({ version: "dev" })), "checkout");
  });

  test("a checkout stays a checkout even from inside node_modules", () => {
    assert.equal(detectChannel(evidence({ version: "dev", entryPath: "/repo/node_modules/.bin/pi-outpost" })), "checkout");
  });

  test("a single-file executable is recognised before any path reasoning", () => {
    // A SEA has no script entry to reason about at all.
    assert.equal(detectChannel(evidence({ isSea: true, entryPath: undefined, execPath: "/opt/pi-outpost" })), "executable");
  });

  test("a global install is the ordinary published case", () => {
    assert.equal(detectChannel(evidence()), "global");
  });

  /**
   * An npx cache *is* a node_modules tree. Testing for node_modules first would
   * call every npx run a global install and try to upgrade a cache directory.
   */
  test("an npx cache is ephemeral, not global, though it contains node_modules", () => {
    const entryPath = "/Users/someone/.npm/_npx/8f3a/node_modules/pi-outpost/dist/pi-outpost.mjs";
    assert.equal(detectChannel(evidence({ entryPath })), "ephemeral");
  });

  test("the same holds on a Windows path", () => {
    const entryPath = "C:\\Users\\someone\\AppData\\Local\\npm-cache\\_npx\\8f3a\\node_modules\\pi-outpost\\dist\\pi-outpost.mjs";
    assert.equal(detectChannel(evidence({ entryPath })), "ephemeral");
  });

  test("a project's own dependency is not a global install", () => {
    // The finding this exists for: `node_modules` alone said "global", so running
    // ./node_modules/.bin/pi-outpost from a project would have run `npm install -g`
    // — upgrading a different copy somewhere else and reporting success for the
    // local one still running, which is the exact failure the channel prevents.
    const entryPath = "/home/someone/project/node_modules/pi-outpost/dist/pi-outpost.mjs";
    assert.equal(detectChannel(evidence({ entryPath })), "unknown");
  });

  test("without a known global root, a node_modules path is unknown rather than assumed", () => {
    const entryPath = "/usr/local/lib/node_modules/pi-outpost/dist/pi-outpost.mjs";
    assert.equal(detectChannel(evidence({ entryPath, globalRoot: undefined })), "unknown");
  });

  test("a global install under a version manager's prefix is still global", () => {
    // The layout differs by platform and installer, which is why the root is asked
    // for rather than derived.
    const globalRoot = "/Users/someone/.nvm/versions/node/v24.0.0/lib/node_modules";
    const entryPath = `${globalRoot}/pi-outpost/dist/pi-outpost.mjs`;
    assert.equal(detectChannel(evidence({ entryPath, globalRoot })), "global");
  });

  test("a published copy outside any node_modules is not guessed at", () => {
    assert.equal(detectChannel(evidence({ entryPath: "/home/someone/bin/pi-outpost.mjs" })), "unknown");
  });

  test("no entry path at all, and not a SEA, is unknown rather than a guess", () => {
    assert.equal(detectChannel(evidence({ entryPath: undefined })), "unknown");
  });

  /**
   * The finding this exists for, from a real `npm install -g`: npm puts the
   * command at `<prefix>/bin/<name>`, a symlink into `<prefix>/lib/node_modules`,
   * and that is the path `process.argv[1]` carries. It has no `node_modules`
   * segment, so an ordinary global install was refused with "cannot tell how this
   * copy was installed" and `update` did nothing at all.
   */
  test("the bin symlink npm installs resolves to the global install behind it", async () => {
    const prefix = await workspace();
    const root = path.join(prefix, "lib", "node_modules");
    const real = path.join(root, "pi-outpost", "dist", "pi-outpost.mjs");
    await mkdir(path.dirname(real), { recursive: true });
    await writeFile(real, "// entry\n");
    await mkdir(path.join(prefix, "bin"), { recursive: true });
    const link = path.join(prefix, "bin", "pi-outpost");
    await symlink(real, link);

    const argv = process.argv[1];
    const envPrefix = process.env.npm_config_prefix;
    process.argv[1] = link;
    process.env.npm_config_prefix = prefix;
    try {
      const seen = currentEvidence("0.15.0");
      assert.equal(seen.entryPath, await realpath(real));
      assert.equal(detectChannel({ ...seen, globalRoot: await realpath(root) }), "global");
    } finally {
      process.argv[1] = argv;
      if (envPrefix === undefined) delete process.env.npm_config_prefix;
      else process.env.npm_config_prefix = envPrefix;
    }
  });
});

describe("isNewer", () => {
  test("orders the three release fields numerically, not as text", () => {
    // "0.10.0" < "0.9.0" as strings, which is the classic way to get this wrong.
    assert.equal(isNewer("0.10.0", "0.9.0"), true);
    assert.equal(isNewer("0.9.0", "0.10.0"), false);
  });

  test("an identical version is not newer", () => {
    assert.equal(isNewer("0.8.0", "0.8.0"), false);
  });

  /** Running a build made between a tag and its publish must not be told to downgrade. */
  test("a version ahead of the registry is not out of date", () => {
    assert.equal(isNewer("0.8.0", "0.9.0"), false);
  });

  test("a prerelease is older than the release it qualifies", () => {
    assert.equal(isNewer("1.2.0", "1.2.0-rc.1"), true);
    assert.equal(isNewer("1.2.0-rc.1", "1.2.0"), false);
  });

  test("numeric prerelease identifiers count, they are not spelled", () => {
    // The bug this exists for: compared as text, "rc.10" < "rc.2", so the tenth
    // release candidate read as older than the second and anyone on rc.2 was told
    // they were current. It only appears once a series reaches double digits.
    assert.equal(isNewer("1.2.0-rc.10", "1.2.0-rc.2"), true);
    assert.equal(isNewer("1.2.0-rc.2", "1.2.0-rc.10"), false);
  });

  test("a longer prerelease outranks the prefix it extends", () => {
    assert.equal(isNewer("1.2.0-rc.1.1", "1.2.0-rc.1"), true);
    assert.equal(isNewer("1.2.0-rc.1", "1.2.0-rc.1.1"), false);
  });

  test("an alphanumeric identifier outranks a numeric one, and text sorts as text", () => {
    assert.equal(isNewer("1.2.0-rc.1", "1.2.0-1"), true);
    assert.equal(isNewer("1.2.0-beta", "1.2.0-alpha"), true);
    assert.equal(isNewer("1.2.0-alpha", "1.2.0-beta"), false);
  });

  test("a version scheme it cannot parse stays quiet rather than nagging", () => {
    assert.equal(isNewer("latest", "0.8.0"), false);
    assert.equal(isNewer("1.0", "0.8.0"), false);
  });
});

describe("fetchLatestVersion", () => {
  const respond = (version: unknown): VersionLookup => async () => version;

  test("reports a newer version with both numbers", async () => {
    const result = await fetchLatestVersion("0.8.0", { lookupImpl: respond("0.9.0") });
    assert.deepEqual(result, { status: "newer", running: "0.8.0", latest: "0.9.0" });
  });

  test("reports current when the registry has nothing later", async () => {
    const result = await fetchLatestVersion("0.9.0", { lookupImpl: respond("0.9.0") });
    assert.equal(result.status, "current");
  });

  test("passes an explicit registry override to npm's lookup", async () => {
    let asked: string | undefined;
    const spy: VersionLookup = async (options) => {
      asked = options.registry;
      return "0.9.0";
    };
    const result = await fetchLatestVersion("0.8.0", { lookupImpl: spy, registry: "https://registry.example" });
    assert.equal(asked, "https://registry.example");
    assert.equal(result.status, "newer");
  });

  /** The whole point of the third state: a failed check is not "you are current". */
  test("a transport error is a failure, not a verdict", async () => {
    const boom: VersionLookup = async () => {
      throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
    };
    const result = await fetchLatestVersion("0.8.0", { lookupImpl: boom });
    assert.equal(result.status, "failed");
    assert.match(result.status === "failed" ? result.reason : "", /ENOTFOUND/);
  });

  test("an answer without a version is a failure, not a comparison against undefined", async () => {
    const result = await fetchLatestVersion("0.8.0", { lookupImpl: respond({ name: "pi-outpost" }) });
    assert.equal(result.status, "failed");
  });

  test("a registry that never answers is bounded", async () => {
    const never: VersionLookup = (options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const started = Date.now();
    const result = await fetchLatestVersion("0.8.0", { lookupImpl: never, timeoutMs: 50 });
    assert.equal(result.status, "failed");
    assert.ok(Date.now() - started < 2_000, "the request must not outlive its timeout");
  });
});

// openlore: {"domain":"update","requirement":"UpdateChecksUseTheConfiguredRegistry","scenario":"UsesThePackageManagerRegistry","specFile":"openspec/specs/update/spec.md"}
describe("extractSingleVersion", () => {
  test("accepts the bare string older npm answers with", () => {
    assert.equal(extractSingleVersion("9.9.9"), "9.9.9");
  });

  test("accepts the one-element array npm 12 answers with", () => {
    assert.equal(extractSingleVersion(["9.9.9"]), "9.9.9");
  });

  test("refuses anything that is not one version string", () => {
    for (const answer of [["9.9.9", "9.9.8"], [], { version: "9.9.9" }, 9.9, ""]) {
      assert.throws(() => extractSingleVersion(answer), /without a version/);
    }
  });
});

describe("the remembered answer", () => {
  test("round-trips through agentDir", async () => {
    const agentDir = await workspace();
    await writeCache(agentDir, { latest: "0.9.0", checkedAt: 1_700_000_000_000 });
    assert.deepEqual(await readCache(agentDir), { latest: "0.9.0", checkedAt: 1_700_000_000_000 });
    assert.equal(path.basename(cachePath(agentDir)), "update-check.json");
  });

  test("an absent cache is nothing, not an error", async () => {
    assert.equal(await readCache(await workspace()), undefined);
  });

  /** An optimisation must never become a startup error. */
  test("a corrupt cache is nothing, not an error", async () => {
    const agentDir = await workspace();
    await writeFile(cachePath(agentDir), "{ not json");
    assert.equal(await readCache(agentDir), undefined);
  });

  test("a cache of the wrong shape is nothing", async () => {
    const agentDir = await workspace();
    await writeFile(cachePath(agentDir), JSON.stringify({ latest: 9, checkedAt: "yesterday" }));
    assert.equal(await readCache(agentDir), undefined);
  });

  test("writing into a directory that does not exist yet still works", async () => {
    const agentDir = path.join(await workspace(), "nested", "agent");
    await writeCache(agentDir, { latest: "1.0.0", checkedAt: 5 });
    assert.match(await readFile(cachePath(agentDir), "utf8"), /1\.0\.0/);
  });

  test("an unwritable location is survived silently", async () => {
    // The next start simply asks again; nothing here is worth failing over.
    //
    // A regular file standing where a directory is needed, rather than a path under
    // /proc. That one hung the whole Linux suite for five minutes and passed
    // everywhere else, because macOS and Windows have no /proc to reach at all — so
    // the test asserted "survived silently" on two platforms and blocked on the
    // third. ENOTDIR arrives immediately, on every platform, for the same reason.
    const root = await workspace();
    const notADirectory = path.join(root, "in-the-way");
    await writeFile(notADirectory, "");
    await writeCache(path.join(notADirectory, "nested"), { latest: "1.0.0", checkedAt: 5 });
  });

  test("a fresh answer is used, a stale one is not", () => {
    const now = 1_700_000_000_000;
    assert.equal(isFresh({ latest: "1.0.0", checkedAt: now - 1000 }, now), true);
    assert.equal(isFresh({ latest: "1.0.0", checkedAt: now - CHECK_INTERVAL_MS - 1 }, now), false);
  });

  test("an answer from the future is stale, not fresh forever", () => {
    // A clock that moved backwards would otherwise pin the cache permanently.
    const now = 1_700_000_000_000;
    assert.equal(isFresh({ latest: "1.0.0", checkedAt: now + CHECK_INTERVAL_MS }, now), false);
  });
});

// ---------------------------------------------------------------------------
// runUpdateCommand
// ---------------------------------------------------------------------------

/**
 * A registry that answers with one version and counts nothing else.
 *
 * The command must never reach the network in a test, and must never install: both
 * are injected, and the install spy is what proves "--check installs nothing" rather
 * than a comment claiming it.
 */
function stubLookup(latest: string): VersionLookup {
  return async () => latest;
}

const unreachable: VersionLookup = async () => {
  throw new Error("getaddrinfo ENOTFOUND registry.example");
};

interface Run {
  code: number;
  lines: string[];
  installs: Array<{ command: string; args: string[] }>;
  said: (pattern: RegExp) => boolean;
}

async function runUpdate(
  over: {
    version?: string;
    checkOnly?: boolean;
    channel?: InstallChannel;
    latest?: string;
    lookupImpl?: VersionLookup;
    installExit?: number;
    checkingDisabled?: boolean;
    disabledReason?: string;
    /** `null` means "no override configured", which is the default deployment. */
    registry?: string | null;
  } = {},
): Promise<Run> {
  const lines: string[] = [];
  const installs: Array<{ command: string; args: string[] }> = [];
  const code = await runUpdateCommand({
    version: over.version ?? "0.8.0",
    checkOnly: over.checkOnly ?? false,
    // Always named, so `detectChannel` is never asked to work it out from this
    // process — which would spawn `npm root -g` per call. What that resolution does
    // is tested directly, next door.
    channel: over.channel ?? "global",
    ...(over.checkingDisabled ? { checkingDisabled: true, disabledReason: over.disabledReason } : {}),
    lookupImpl: over.lookupImpl ?? stubLookup(over.latest ?? "0.9.0"),
    ...(over.registry === null ? {} : { registry: over.registry ?? "https://registry.example" }),
    install: async (command, args) => {
      installs.push({ command, args });
      return over.installExit ?? 0;
    },
    log: (line) => lines.push(line),
  });
  return { code, lines, installs, said: (pattern) => lines.some((line) => pattern.test(line)) };
}

describe("npmCommand", () => {
  test("names npm.cmd on Windows and npm elsewhere", () => {
    // Passing "" rather than undefined: an omitted argument falls back to this
    // process's own npm_execpath, which npm sets for `npm test` — the table would
    // then assert the environment rather than the rule, and pass locally under
    // `node --test` while failing in CI.
    assert.deepEqual(npmCommand("win32", ""), ["npm.cmd", []]);
    assert.deepEqual(npmCommand("darwin", ""), ["npm", []]);
    assert.equal(npmExecutable("win32"), "npm.cmd");
    assert.equal(npmExecutable("linux"), "npm");
  });

  test("npm's own exported path wins on every platform", () => {
    // npm_execpath is npm telling us which npm is running, and it is a .js file
    // this node can run directly — no batch file in the way.
    for (const platform of ["win32", "darwin"] as const) {
      assert.deepEqual(npmCommand(platform, "/npm/bin/npm-cli.js"), [process.execPath, ["/npm/bin/npm-cli.js"]]);
    }
  });

  test("runs npm.cmd through cmd.exe on Windows without putting the registry in shell input", () => {
    const registry = "https://nexus.internal/npm?one=1&two=2";
    const invocation = npmViewInvocation(registry, "win32", "");
    assert.match(invocation.command.toLowerCase(), /cmd(?:\.exe)?$/);
    assert.deepEqual(invocation.args, [
      "/d",
      "/s",
      "/c",
      "npm.cmd view pi-outpost@latest version --json",
    ]);
    assert.equal(invocation.env.npm_config_registry, registry);
    assert.ok(!invocation.args.some((arg) => arg.includes(registry)));
  });

  test("removes case-insensitive registry collisions before applying a Windows override", () => {
    const previousUpper = process.env.NPM_CONFIG_REGISTRY;
    const previousLower = process.env.npm_config_registry;
    process.env.NPM_CONFIG_REGISTRY = "https://wrong.example";
    process.env.npm_config_registry = "https://also-wrong.example";
    try {
      const invocation = npmViewInvocation("https://nexus.internal/npm", "win32", "");
      const registryKeys = Object.keys(invocation.env)
        .filter((key) => key.toLowerCase() === "npm_config_registry");
      assert.deepEqual(registryKeys, ["npm_config_registry"]);
      assert.equal(invocation.env.npm_config_registry, "https://nexus.internal/npm");
    } finally {
      if (previousUpper === undefined) delete process.env.NPM_CONFIG_REGISTRY;
      else process.env.NPM_CONFIG_REGISTRY = previousUpper;
      if (previousLower === undefined) delete process.env.npm_config_registry;
      else process.env.npm_config_registry = previousLower;
    }
  });

  test("runs a Windows install through cmd.exe with a fixed shell command", () => {
    const registry = "https://nexus.internal/npm?one=1&two=2";
    const invocation = npmInstallInvocation(registry, "win32");
    assert.match(invocation.command.toLowerCase(), /cmd(?:\.exe)?$/);
    assert.deepEqual(invocation.args, ["/d", "/s", "/c", "npm.cmd install -g pi-outpost@latest"]);
    assert.equal(invocation.env.npm_config_registry, registry);
    assert.ok(!invocation.args.some((arg) => arg.includes(registry)));
  });

  test("asks npm for its global root through cmd.exe on Windows, with a fixed shell command", async () => {
    // The global root decides whether this copy is a global install. Run as a bare
    // npm.cmd, current Node refuses the batch file, the root stays unknown, and update
    // refuses the install it has just found a newer version for — reported from Windows.
    const { npmRootInvocation } = await import("../src/update.ts");
    const invocation = npmRootInvocation("win32", "");
    assert.match(invocation.command.toLowerCase(), /cmd(?:\.exe)?$/);
    assert.deepEqual(invocation.args, ["/d", "/s", "/c", "npm.cmd root -g"]);
    assert.deepEqual(npmRootInvocation("darwin", "").args, ["root", "-g"]);
    assert.equal(npmRootInvocation("darwin", "").command, "npm");
    // npm's own exported path still wins, run by this node — no batch file in the way.
    assert.deepEqual(npmRootInvocation("win32", "/npm/bin/npm-cli.js").args, ["/npm/bin/npm-cli.js", "root", "-g"]);
  });

  test(
    "the Windows global-root invocation really answers with npm's node_modules",
    { skip: process.platform !== "win32" && "cmd.exe exists only on Windows" },
    async () => {
      // Against the real batch file: the unit test above pins the argv, this one proves
      // Windows runs it, which is the part that was broken.
      const { execFileSync } = await import("node:child_process");
      const { npmRootInvocation } = await import("../src/update.ts");
      const { command, args, env } = npmRootInvocation("win32", "");
      const root = execFileSync(command, args, { encoding: "utf8", env, windowsHide: true, timeout: 60_000 }).trim();
      assert.match(root, /node_modules$/i);
    },
  );
});

describe("update --check", () => {
  test("a newer version is reported with both numbers, and nothing is installed", async () => {
    const run = await runUpdate({ checkOnly: true, channel: "global", latest: "0.9.0" });
    assert.equal(run.code, 0);
    assert.ok(run.said(/0\.8\.0 is installed; 0\.9\.0 is available/));
    assert.deepEqual(run.installs, []);
  });

  test("being current says so and exits zero", async () => {
    const run = await runUpdate({ checkOnly: true, channel: "global", latest: "0.8.0" });
    assert.equal(run.code, 0);
    assert.ok(run.said(/0\.8\.0 is the newest published version/));
    assert.deepEqual(run.installs, []);
  });

  test("a registry it cannot reach is a failure, never a claim of currency", async () => {
    const run = await runUpdate({ checkOnly: true, channel: "global", lookupImpl: unreachable });
    assert.equal(run.code, 1, "a failed check must not exit zero");
    assert.ok(run.said(/could not check for updates/));
    assert.ok(!run.said(/newest published version/), "a failed check must not read as up to date");
  });

  test("a checkout is not told it is current, since it has no published version", async () => {
    // "dev" never compares as newer, and the first version of this reported that as
    // "dev is the newest published version" — false, and the answer that stops
    // someone looking any further.
    const run = await runUpdate({ checkOnly: true, version: "dev", channel: "checkout", latest: "0.9.0" });
    assert.ok(run.said(/not a published one/));
    assert.ok(run.said(/newest published version is 0\.9\.0/));
    assert.ok(!run.said(/dev is the newest/));
  });

  test("installs nothing on every channel, whatever the verdict", async () => {
    for (const channel of ["global", "checkout", "ephemeral", "executable", "unknown"] as InstallChannel[]) {
      const run = await runUpdate({ checkOnly: true, channel, latest: "9.9.9" });
      assert.deepEqual(run.installs, [], `${channel} installed something under --check`);
    }
  });

  test("configuration that disabled checking is named, and no request is made", async () => {
    let asked = false;
    const spy: VersionLookup = async () => {
      asked = true;
      return "9.9.9";
    };
    const run = await runUpdate({
      checkOnly: true,
      checkingDisabled: true,
      disabledReason: '"updateCheck" is false',
      lookupImpl: spy,
    });
    assert.equal(run.code, 1);
    assert.ok(run.said(/update checking is disabled: "updateCheck" is false/));
    assert.equal(asked, false, "a disabled check must not reach the registry");
  });
});

describe("update, by channel", () => {
  test("a global install is upgraded with the command that was printed", async () => {
    const run = await runUpdate({ channel: "global", latest: "0.9.0", registry: null });
    assert.equal(run.code, 0);
    // `npmExecutable()` rather than the literal "npm": on Windows it is npm.cmd,
    // and pinning the name here would assert the very bug this file now guards.
    const invocation = npmInstallInvocation();
    assert.deepEqual(run.installs, [{ command: invocation.command, args: invocation.args }]);
    // The printed command and the executed one must be the same thing: printing it
    // is what makes the action auditable, and a mismatch makes that worse than useless.
    const printed = run.lines.find((line) => line.startsWith("[pi] running:"));
    assert.equal(printed, `[pi] running: ${invocation.displayCommand} ${invocation.displayArgs.join(" ")}`);
  });

  test("the installer runs the npm this platform can actually execute", async () => {
    // On Windows npm is `npm.cmd`, a batch file: spawning the bare name with
    // shell:false fails with ENOENT before npm starts, and the failure was
    // reported as "the installer exited with 1" — npm blamed for never having
    // run. This assertion is evaluated on the Windows CI job too, which is the
    // only place the regression can be seen.
    // `registry: null` for the bare form: an override would add --registry and
    // say nothing about the command, which is what this test is about.
    const run = await runUpdate({ channel: "global", latest: "0.9.0", registry: null });
    const invocation = npmInstallInvocation();
    assert.equal(run.installs[0]?.command, invocation.command);
    assert.deepEqual(run.installs[0]?.args, invocation.args);
    assert.ok(run.said(/running: npm(\.cmd)? install -g/), `announced: ${run.lines.join(" | ")}`);
  });

  test("the installed version is never taken from the registry answer", async () => {
    // @latest, not the fetched string: the registry says what is newest, and does
    // not get to say what gets installed.
    const run = await runUpdate({ channel: "global", latest: "9.9.9", registry: null });
    assert.deepEqual(run.installs[0]?.args, npmInstallInvocation().args);
    assert.ok(!JSON.stringify(run.installs).includes("9.9.9"));
  });

  test("a version the registry answered that cannot be parsed installs nothing", async () => {
    // Belt and braces on the same worry from the other side: a string that is not a
    // version never compares as newer, so it cannot reach the installer at all.
    const run = await runUpdate({ channel: "global", latest: "0.9.0; rm -rf /" });
    assert.deepEqual(run.installs, []);
  });

  // openlore: {"domain":"update","requirement":"UpdateChecksUseTheConfiguredRegistry","scenario":"TheInstallUsesTheRegistryTheCheckUsed","specFile":"openspec/specs/update/spec.md"}
  test("a configured registry is passed to the installer, so check and install agree", async () => {
    // Without this the check queries the internal proxy and the install fetches from
    // the public one: an update announced from one registry and performed from
    // another, in exactly the deployment the setting exists for.
    const run = await runUpdate({ channel: "global", latest: "0.9.0", registry: "https://nexus.internal/npm" });
    assert.deepEqual(run.installs[0]?.args, npmInstallInvocation("https://nexus.internal/npm").args);
    // And what was printed is still what was run.
    assert.equal(
      run.lines.find((line) => line.startsWith("[pi] running:")),
      `[pi] running: ${npmExecutable()} install -g --registry https://nexus.internal/npm pi-outpost@latest`,
    );
  });

  test("no override leaves the command bare, so npm reads its own configuration", async () => {
    const run = await runUpdate({ channel: "global", latest: "0.9.0", registry: null });
    assert.deepEqual(run.installs[0]?.args, npmInstallInvocation().args);
  });

  test("an installer that fails surfaces its code and claims nothing", async () => {
    const run = await runUpdate({ channel: "global", latest: "0.9.0", installExit: 243 });
    assert.equal(run.code, 243);
    assert.ok(run.said(/exited with 243/));
    assert.ok(!run.said(/installed pi-outpost/));
  });

  test("a global install with nothing newer runs no installer", async () => {
    const run = await runUpdate({ channel: "global", latest: "0.8.0" });
    assert.equal(run.code, 0);
    assert.deepEqual(run.installs, []);
  });

  test("a checkout is refused and pointed at version control", async () => {
    const run = await runUpdate({ version: "dev", channel: "checkout", latest: "0.9.0" });
    assert.equal(run.code, 1);
    assert.ok(run.said(/source checkout/));
    assert.ok(run.said(/git pull/));
    assert.deepEqual(run.installs, [], "a second copy must never be installed elsewhere");
  });

  test("an ephemeral run is told its next invocation already fetches", async () => {
    const run = await runUpdate({ channel: "ephemeral", latest: "0.9.0" });
    assert.equal(run.code, 1);
    assert.ok(run.said(/npx pi-outpost/));
    assert.deepEqual(run.installs, []);
  });

  test("an executable refuses to replace itself and points at the releases", async () => {
    const run = await runUpdate({ channel: "executable", latest: "0.9.0" });
    assert.equal(run.code, 1);
    assert.ok(run.said(/will not replace itself/));
    assert.ok(run.said(/github\.com\/laurentftech\/pi-outpost\/releases/));
    assert.deepEqual(run.installs, []);
  });

  test("an unrecognised layout prints what it saw rather than guessing", async () => {
    const run = await runUpdate({ channel: "unknown", latest: "0.9.0" });
    assert.equal(run.code, 1);
    assert.ok(run.said(/cannot tell how this copy was installed/));
    assert.ok(run.said(/entry:/));
    // What a global install is recognised by: when npm could not say, the reader is told.
    assert.ok(run.said(/npm global node_modules: /));
    assert.ok(run.said(/runtime:/));
    assert.deepEqual(run.installs, []);
  });

  test("a channel that cannot be upgraded is refused even when nothing is newer", async () => {
    // The refusal used to sit behind the version comparison, so it was unreachable
    // for a checkout — whose version never compares as newer — and would only ever
    // have run in the release where something newer happened to exist.
    for (const channel of ["checkout", "ephemeral", "executable", "unknown"] as InstallChannel[]) {
      const run = await runUpdate({ channel, latest: "0.8.0" });
      assert.equal(run.code, 1, `${channel} did not refuse when already current`);
      assert.deepEqual(run.installs, []);
    }
  });
});

// ---------------------------------------------------------------------------
// the notice at startup
// ---------------------------------------------------------------------------

describe("whether to check at startup", () => {
  const decide = (settings: { updateCheck?: boolean; offline?: boolean }, channel: InstallChannel = "global") =>
    shouldCheckAtStartup({ settings, channel });

  test("nothing configured means yes", () => {
    assert.equal(decide({}), true);
  });

  test("offline turns it off while the key is unmentioned", () => {
    assert.equal(decide({ offline: true }), false);
  });

  /**
   * The rule the first draft got wrong. Air-gapped from model catalogs while
   * reaching npm through an internal proxy is a real deployment, and treating
   * offline as a veto forbade checking on exactly the host that needs it most.
   */
  test("asking for it explicitly beats offline", () => {
    assert.equal(decide({ offline: true, updateCheck: true }), true);
  });

  test("turning it off explicitly beats everything", () => {
    assert.equal(decide({ updateCheck: false }), false);
    assert.equal(decide({ updateCheck: false, offline: false }), false);
  });

  test("a checkout is never compared, whatever the settings say", () => {
    // A working tree has no published version to be behind, so the notice could
    // only ever be noise — on every start, for every developer.
    assert.equal(decide({}, "checkout"), false);
    assert.equal(decide({ updateCheck: true }, "checkout"), false);
  });
});

describe("the startup notice", () => {
  /** Counts requests, so "made no request" is asserted rather than assumed. */
  function countingLookup(latest: string): { lookupImpl: VersionLookup; calls: () => number } {
    let calls = 0;
    const lookupImpl: VersionLookup = async () => {
      calls += 1;
      return latest;
    };
    return { lookupImpl, calls: () => calls };
  }

  async function notice(over: {
    version?: string;
    settings?: { updateCheck?: boolean; offline?: boolean };
    channel?: InstallChannel;
    latest?: string;
    lookupImpl?: VersionLookup;
    now?: number;
    agentDir?: string;
    onNewer?: (notice: OutpostUpdateNotice) => void;
  }): Promise<{ lines: string[]; agentDir: string }> {
    const lines: string[] = [];
    const agentDir = over.agentDir ?? (await workspace());
    await runStartupUpdateNotice({
      ...(over.onNewer ? { onNewer: over.onNewer } : {}),
      version: over.version ?? "0.8.0",
      agentDir,
      settings: over.settings ?? {},
      channel: over.channel ?? "global",
      registry: "https://registry.example",
      ...(over.lookupImpl ? { lookupImpl: over.lookupImpl } : {}),
      ...(over.now !== undefined ? { now: over.now } : {}),
      log: (line) => lines.push(line),
    });
    return { lines, agentDir };
  }

  test("says a newer version exists, and names the command that acts on it", async () => {
    const { lookupImpl } = countingLookup("0.9.0");
    const { lines } = await notice({ lookupImpl });
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /0\.9\.0 is available \(running 0\.8\.0\)/);
    assert.match(lines[0]!, /pi-outpost update/);
  });

  test("is silent when the running version is current", async () => {
    const { lookupImpl } = countingLookup("0.8.0");
    const { lines } = await notice({ lookupImpl });
    assert.deepEqual(lines, []);
  });

  test("is silent when the check fails, and remembers nothing", async () => {
    const boom: VersionLookup = async () => {
      throw new Error("ENOTFOUND");
    };
    const { lines, agentDir } = await notice({ lookupImpl: boom });
    assert.deepEqual(lines, []);
    // A failure must not become a remembered answer that suppresses the next real one.
    assert.equal(await readCache(agentDir), undefined);
  });

  test("a fresh cached answer is used, and no request is made", async () => {
    const agentDir = await workspace();
    const now = Date.now();
    await writeCache(agentDir, { latest: "0.9.0", checkedAt: now });
    const { lookupImpl, calls } = countingLookup("0.9.0");
    const { lines } = await notice({ agentDir, lookupImpl, now: now + 1000 });
    assert.equal(calls(), 0, "a fresh cache must not be re-queried");
    assert.match(lines[0] ?? "", /0\.9\.0 is available/);
  });

  test("a stale cached answer is replaced by a fresh query", async () => {
    const agentDir = await workspace();
    const now = Date.now();
    await writeCache(agentDir, { latest: "0.8.5", checkedAt: now - CHECK_INTERVAL_MS - 1 });
    const { lookupImpl, calls } = countingLookup("0.9.0");
    await notice({ agentDir, lookupImpl, now });
    assert.equal(calls(), 1);
    assert.deepEqual(await readCache(agentDir), { latest: "0.9.0", checkedAt: now });
  });

  test("every suppression rule stops the request reaching the registry", async () => {
    for (const [label, over] of [
      ["offline with the key unset", { settings: { offline: true } }],
      ["the key explicitly off", { settings: { updateCheck: false } }],
      ["the key off under offline", { settings: { updateCheck: false, offline: true } }],
      ["a source checkout", { settings: {}, channel: "checkout" as InstallChannel, version: "dev" }],
    ] as const) {
      const { lookupImpl, calls } = countingLookup("9.9.9");
      const { lines } = await notice({ ...over, lookupImpl });
      assert.equal(calls(), 0, `${label} still queried the registry`);
      assert.deepEqual(lines, [], `${label} still printed something`);
    }
  });

  test("says a thing and remembers a thing, and installs nothing", async () => {
    // The startup path has no installer to spy on, which is the point: the only way
    // for a version to be installed is the update command run without --check. This
    // pins the full set of effects, so an installer appearing here would show up as
    // an effect this test does not allow.
    const { lookupImpl } = countingLookup("0.9.0");
    const agentDir = await workspace();
    const before = await readdir(agentDir);
    const { lines } = await notice({ agentDir, lookupImpl });

    assert.equal(lines.length, 1, "the notice is one line, not a transcript of an install");
    assert.match(lines[0]!, /is available/);
    assert.ok(!/install|npm/i.test(lines[0]!), "the startup notice must not read as having installed anything");

    // The cache, and nothing else: no package directory, no downloaded file.
    const after = await readdir(agentDir);
    assert.deepEqual(
      after.filter((entry) => !before.includes(entry)),
      ["update-check.json"],
    );
  });

  test("explicitly enabled still checks under offline", async () => {
    const { lookupImpl, calls } = countingLookup("0.9.0");
    const { lines } = await notice({ settings: { offline: true, updateCheck: true }, lookupImpl });
    assert.equal(calls(), 1, "an explicit yes must survive offline");
    assert.match(lines[0] ?? "", /0\.9\.0 is available/);
  });
  test("tells the interface about a newer version, with what this installation should do", async () => {
    // ANewerVersionIsAnnouncedInTheInterface — the server half
    const told: OutpostUpdateNotice[] = [];
    await notice({ version: "0.26.0", lookupImpl: countingLookup("0.27.0").lookupImpl, onNewer: (n) => told.push(n) });
    assert.deepEqual(told, [
      { running: "0.26.0", latest: "0.27.0", instruction: 'Run "pi-outpost update" in a terminal, then restart it.', copy: "pi-outpost update" },
    ]);

    const exe: OutpostUpdateNotice[] = [];
    await notice({ version: "0.26.0", channel: "executable", lookupImpl: countingLookup("0.27.0").lookupImpl, onNewer: (n) => exe.push(n) });
    assert.match(exe[0]?.instruction ?? "", /Download the new build/);
  });

  test("tells the interface nothing when current, when the check fails, when off, or for a one-off run", async () => {
    // NoNoticeWithoutANewerVersion — the server half
    const told: OutpostUpdateNotice[] = [];
    const onNewer = (n: OutpostUpdateNotice) => told.push(n);
    await notice({ version: "0.27.0", lookupImpl: countingLookup("0.27.0").lookupImpl, onNewer });
    await notice({ version: "0.26.0", lookupImpl: async () => { throw new Error("unreachable"); }, onNewer });
    await notice({ version: "0.26.0", settings: { updateCheck: false }, lookupImpl: countingLookup("0.27.0").lookupImpl, onNewer });
    await notice({ version: "0.26.0", channel: "ephemeral", lookupImpl: countingLookup("0.27.0").lookupImpl, onNewer });
    assert.deepEqual(told, []);
  });
});

describe("looking up another package", () => {
  test("npm view names the package asked for, scoped names included", () => {
    const invocation = npmViewInvocation(undefined, "darwin", "/npm/bin/npm-cli.js", "@gotgenes/pi-permission-system");
    assert.ok(invocation.args.includes("@gotgenes/pi-permission-system@latest"));
    const windows = npmViewInvocation(undefined, "win32", "", "openlore");
    assert.equal(windows.args.at(-1), "npm.cmd view openlore@latest version --json");
  });

  test("a name that is not an npm package name never reaches a command line", () => {
    for (const hostile of ["openlore & calc", "../x", "Open Lore", "@scope/../x", ""]) {
      assert.throws(() => npmViewInvocation(undefined, "win32", "", hostile), /not an npm package name/);
    }
  });

  test("the lookup is asked for that package, and its failure is a failed check with the reason", async () => {
    let asked: string | undefined;
    const found = await fetchLatestVersion("33.0.1", {
      packageName: "@gotgenes/pi-permission-system",
      lookupImpl: async (options) => {
        asked = options.packageName;
        return "33.1.0";
      },
    });
    assert.equal(asked, "@gotgenes/pi-permission-system");
    assert.deepEqual(found, { status: "newer", running: "33.0.1", latest: "33.1.0" });

    const refused = await fetchLatestVersion("1.0.0", {
      packageName: "openlore & calc",
      lookupImpl: async (options) => npmViewInvocation(undefined, "win32", "", options.packageName),
    });
    assert.equal(refused.status, "failed");
    assert.match(refused.status === "failed" ? refused.reason : "", /not an npm package name/);
  });
});
