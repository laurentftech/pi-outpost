/**
 * Where the configuration comes from, and who wins when several places answer.
 *
 * These drive the real CLI as a child process — its own argv, its own environment,
 * its own XDG home — because the thing under test *is* the wiring between argv, env,
 * $XDG_CONFIG_HOME and the file system, which importing loadConfig() would bypass.
 *
 * They use `pi-outpost config`, which resolves everything and prints it without
 * starting a server: no agent session, no port to reserve, no process to kill.
 * That one boot path is covered by the other suites, which all go through the same
 * loadConfig().
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SERVER_DIR, "src", "index.ts");
const TSX = path.join(SERVER_DIR, "..", "node_modules", ".bin", "tsx");
const isWindows = process.platform === "win32";

// Absolute path to tsx ESM loader so --import works regardless of CWD
const TSX_LOADER = path.join(SERVER_DIR, "..", "node_modules", "tsx", "dist", "esm", "index.mjs");

/**
 * Resolve the command and args to run a TypeScript file via tsx.
 * On Windows, execFile cannot run `.cmd` wrappers directly, so we use
 * `node --import=file:///...tsx-loader` instead (same pattern as the test harness).
 * The path must be a file:// URL because Windows drive letters (D:...) are
 * rejected by the ESM loader as an unsupported URL scheme.
 */
function commandArgs(entryArgs) {
  if (isWindows) {
    const loaderUrl = pathToFileURL(TSX_LOADER).href;
    return [process.execPath, [`--import=${loaderUrl}`, ENTRY, ...entryArgs]];
  }
  return [TSX, [ENTRY, ...entryArgs]];
}

/**
 * Run the CLI and return what the user would see. Never throws on a non-zero exit —
 * refusing to start *is* the expected outcome of half these cases.
 */
async function cli(args, { cwd, env = {} } = {}) {
  const [cmd, cmdArgs] = commandArgs(args);
  try {
    const { stdout, stderr } = await run(cmd, cmdArgs, {
      cwd,
      // None of these commands serve — but a bug that made one of them hang must
      // fail the test, not the job (a test with no timeout froze CI for 19 minutes)
      timeout: 60_000,
      env: {
        ...process.env,
        // A test must never pick up the developer's own config, in any of the four places
        PI_OUTPOST_CONFIG: undefined,
        PI_OUTPOST_PROFILE: undefined,
        INIT_CWD: cwd,
        ...env,
      },
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    return { code: error.code ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

/** The resolved configuration `pi-outpost config` printed (it logs a line before the JSON). */
function resolved(out) {
  const json = out.slice(out.indexOf("{"));
  return JSON.parse(json);
}

const configWithPort = (port) => JSON.stringify({ server: { port, host: "127.0.0.1" } });

describe("configuration: discovery, precedence, profiles", () => {
  let dir;
  let xdg;
  let userConfig;

  before(async () => {
    // realpath: on macOS the temp dir is /var/… , a symlink to /private/var/… , and the
    // child's process.cwd() reports the real one — so compare against what it will say
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "pi-outpost-config-")));
    xdg = path.join(dir, "xdg");
    userConfig = path.join(xdg, "pi-outpost", "config.json");
    await mkdir(path.join(xdg, "pi-outpost", "profiles"), { recursive: true });
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("refuses to start when no config file exists anywhere", async () => {
    const { code, out } = await cli([], { cwd: dir, env: { XDG_CONFIG_HOME: xdg } });
    assert.equal(code, 1);
    assert.match(out, /no configuration file found/);
    assert.match(out, /pi-outpost init/);
    // the two implicit locations it looked in, named so the user can act on it
    assert.match(out, /pi-outpost\.config\.json/);
    assert.match(out, /xdg\/pi-outpost\/config\.json/);
  });

  test("finds the user-level config when the directory has none", async () => {
    await writeFile(userConfig, configWithPort(4001));
    const { out } = await cli(["config"], { cwd: dir, env: { XDG_CONFIG_HOME: xdg } });
    assert.equal(resolved(out).configFile, userConfig);
    assert.equal(resolved(out).port, 4001);
  });

  test("a local config wins over the user-level one, and is not merged with it", async () => {
    const local = path.join(dir, "pi-outpost.config.json");
    // The user-level file (still there, still port 4001) must contribute nothing
    await writeFile(local, JSON.stringify({ server: { port: 4002 } }));
    const { out } = await cli(["config"], { cwd: dir, env: { XDG_CONFIG_HOME: xdg } });
    const config = resolved(out);
    assert.equal(config.configFile, local);
    assert.equal(config.port, 4002);
    assert.equal(config.host, "127.0.0.1", "the default, not the user-level file's value");
  });

  test("the environment beats the config file", async () => {
    const { out } = await cli(["config"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg, PI_OUTPOST_PORT: "4003" },
    });
    assert.equal(resolved(out).port, 4003, "PI_OUTPOST_PORT must override server.port");
  });

  test("a bare PORT is honoured too (platforms inject it)", async () => {
    const { out } = await cli(["config"], { cwd: dir, env: { XDG_CONFIG_HOME: xdg, PORT: "4004" } });
    assert.equal(resolved(out).port, 4004);
  });

  test("a flag beats the environment", async () => {
    const { out } = await cli(["config", "--port", "4005"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg, PI_OUTPOST_PORT: "4003" },
    });
    assert.equal(resolved(out).port, 4005);
  });

  test("the token is never printed back, only its presence", async () => {
    const { out } = await cli(["config"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg, PI_OUTPOST_TOKEN: "hunter2-and-then-some" },
    });
    assert.equal(resolved(out).token, "<set>");
    assert.doesNotMatch(out, /hunter2/);
  });

  test("--profile reads the named file from the user config dir", async () => {
    await writeFile(path.join(xdg, "pi-outpost", "profiles", "work.json"), configWithPort(4006));
    // A local config exists too — the profile is explicit, so it must win
    const { out } = await cli(["config", "--profile", "work"], { cwd: dir, env: { XDG_CONFIG_HOME: xdg } });
    const config = resolved(out);
    assert.match(config.configFile, /profiles\/work\.json$/);
    assert.equal(config.port, 4006);
  });

  test("an unknown profile is an error, not a silent fallback", async () => {
    const { code, out } = await cli(["config", "--profile", "nope"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg },
    });
    assert.equal(code, 1);
    assert.match(out, /profile "nope" not found/);
  });

  test("--config and --profile together is an error", async () => {
    const { code, out } = await cli(["config", "--profile", "work", "--config", "x.json"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg },
    });
    assert.equal(code, 1);
    assert.match(out, /both name a configuration/);
  });

  test("an explicit --config that does not exist is an error", async () => {
    const { code, out } = await cli(["config", "--config", "nope.json"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg },
    });
    assert.equal(code, 1);
    assert.match(out, /config file not found/);
  });

  test("an unknown flag names itself and points at --help", async () => {
    const { code, out } = await cli(["--porte", "8080"], { cwd: dir, env: { XDG_CONFIG_HOME: xdg } });
    assert.equal(code, 2);
    assert.match(out, /--porte/);
    assert.match(out, /--help/);
  });

  test("a read-only sandbox follows the workspace the user names", async () => {
    const project = path.join(dir, "project");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(dir, "readonly.json"), JSON.stringify({ sandbox: { allowWrite: false } }));

    const { out } = await cli(["config", "--config", "readonly.json", "--cwd", "project"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg },
    });
    const config = resolved(out);
    assert.equal(config.cwd, path.join(dir, "project"));
    assert.equal(config.sandbox.root, path.join(dir, "project"), "moving the workspace moves the read scope");
  });

  // The one that matters: a config file's *grant* must not be widened from outside it
  for (const [what, sandbox] of [
    ["write", { allowWrite: true }],
    ["bash", { allowBash: true }],
  ]) {
    test(`a sandbox granting ${what} with no explicit root refuses a cwd override`, async () => {
      const file = path.join(dir, `grants-${what}.json`);
      // The author scoped the grant to their project by relying on "root defaults to cwd"
      await writeFile(file, JSON.stringify({ cwd: ".", sandbox }));

      // An inherited variable — a shell profile, a CI job, a compose file — tries to
      // redefine the workspace, and with it the reach of the grant
      const viaEnv = await cli(["config", "--config", file], {
        cwd: dir,
        env: { XDG_CONFIG_HOME: xdg, PI_OUTPOST_CWD: "/" },
      });
      assert.equal(viaEnv.code, 1, `PI_OUTPOST_CWD=/ must not silently widen ${what} to the whole disk`);
      assert.match(viaEnv.out, /"sandbox\.root"/);

      const viaFlag = await cli(["config", "--config", file, "--cwd", "/"], {
        cwd: dir,
        env: { XDG_CONFIG_HOME: xdg },
      });
      assert.equal(viaFlag.code, 1);

      // Naming the root is all it takes — the grant then says what it covers
      await writeFile(file, JSON.stringify({ cwd: ".", sandbox: { ...sandbox, root: "." } }));
      const explicit = await cli(["config", "--config", file, "--cwd", "/"], {
        cwd: dir,
        env: { XDG_CONFIG_HOME: xdg },
      });
      assert.equal(explicit.code, 0);
      assert.equal(resolved(explicit.out).sandbox.root, dir, "the root the file named, not the overridden cwd");
    });
  }

  test("a profile name cannot climb out of the profiles directory", async () => {
    const { code, out } = await cli(["config", "--profile", "../../../etc/passwd"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg },
    });
    assert.equal(code, 1);
    assert.match(out, /is not a name/);
  });

  test("an explicit --config outranks an inherited PI_OUTPOST_PROFILE", async () => {
    const named = path.join(dir, "named.json");
    await writeFile(named, configWithPort(4007));
    const { code, out } = await cli(["config", "--config", named], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg, PI_OUTPOST_PROFILE: "work" },
    });
    assert.equal(code, 0, "flag > env — an exported profile must not make --config fail");
    assert.equal(resolved(out).configFile, named);
  });

  test("refuses to listen off loopback without a token", async () => {
    const bare = await cli(["config", "--host", "0.0.0.0"], { cwd: dir, env: { XDG_CONFIG_HOME: xdg } });
    assert.equal(bare.code, 1);
    assert.match(bare.out, /without an auth token/);

    const withToken = await cli(["config", "--host", "0.0.0.0"], {
      cwd: dir,
      env: { XDG_CONFIG_HOME: xdg, PI_OUTPOST_TOKEN: "a-long-random-secret" },
    });
    assert.equal(withToken.code, 0);
  });

  test("init --global does not pin the agent to the config directory", async () => {
    const home = path.join(dir, "global-xdg");
    const elsewhere = path.join(dir, "elsewhere");
    await mkdir(elsewhere, { recursive: true });

    const init = await cli(["init", "--global"], { cwd: elsewhere, env: { XDG_CONFIG_HOME: home } });
    assert.equal(init.code, 0);
    assert.match(init.out, /global-xdg\/pi-outpost\/config\.json/);

    const { out } = await cli(["config"], { cwd: elsewhere, env: { XDG_CONFIG_HOME: home } });
    const config = resolved(out);
    // Not ~/.config/pi-outpost: a global config must work *from* wherever you run it,
    // and must never leave the file granting the sandbox inside the sandbox
    assert.equal(config.cwd, elsewhere);
    assert.equal(config.sandbox.root, elsewhere);
  });

  test("init writes a config the server then accepts", async () => {
    const fresh = path.join(dir, "fresh");
    await mkdir(fresh, { recursive: true });

    const init = await cli(["init"], { cwd: fresh, env: { XDG_CONFIG_HOME: xdg } });
    assert.equal(init.code, 0);
    assert.match(init.out, /wrote .*fresh\/pi-outpost\.config\.json/);

    const { code, out } = await cli(["config"], { cwd: fresh, env: { XDG_CONFIG_HOME: xdg } });
    assert.equal(code, 0);
    const config = resolved(out);
    assert.equal(config.port, 3141);
    assert.equal(config.sandbox.allowBash, false, "the starter config must not hand out bash");
    assert.equal(config.sandbox.allowWrite, false);

    const again = await cli(["init"], { cwd: fresh, env: { XDG_CONFIG_HOME: xdg } });
    assert.equal(again.code, 1);
    assert.match(again.out, /already exists/);
  });
});
