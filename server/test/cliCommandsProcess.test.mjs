/**
 * The one-shot commands of the real CLI, driven as the user runs them: `--help`,
 * `--version`, `build-exe`'s refusal, `config --confine`, `login` with a piped key and
 * `logout`. Each runs `src/index.ts` as a child with its own argv, environment and agent
 * directory, then the test reads back what was printed, the exit code, and — for the
 * credential commands — the auth.json the command left behind.
 *
 * Unit tests cover the functions these commands call (cli.ts, credentials.ts,
 * confineCommand.ts, buildExe.ts); what they cannot show is the wiring in index.ts: that
 * the command is reached before a server would start, that a refusal exits non-zero with
 * its message, and that a key is stored in the agent directory *this* configuration uses.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { envWithoutCoverageSink } from "./childEnv.mjs";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SERVER_DIR, "src", "index.ts");
// node --import=<tsx loader URL>, not the tsx .cmd wrapper: spawn cannot run a batch file on Windows.
const TSX_LOADER = pathToFileURL(path.join(SERVER_DIR, "..", "node_modules", "tsx", "dist", "esm", "index.mjs")).href;

/**
 * Run the CLI with `input` on a piped (non-TTY) stdin. Resolves with the exit code and
 * stdout + stderr; never rejects on a non-zero exit, which is half of what is tested.
 */
function cli(args, { cwd, input = "", env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`--import=${TSX_LOADER}`, ENTRY, ...args], {
      cwd,
      env: envWithoutCoverageSink({
        // Never the developer's own configuration, credentials or network.
        PI_OUTPOST_CONFIG: undefined,
        PI_OUTPOST_PROFILE: undefined,
        PI_CODING_AGENT_DIR: undefined,
        ANTHROPIC_API_KEY: undefined,
        PI_OFFLINE: "1",
        // Nor the developer's user configuration (~/.config/pi-outpost), which every command reads.
        // A directory that never exists: no user configuration is found.
        XDG_CONFIG_HOME: path.join(tmpdir(), `pi-cli-commands-no-xdg-${process.pid}`),
        INIT_CWD: cwd,
        ...env,
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    // A command that hangs must fail its test, not freeze the job.
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.stdin.end(input);
  });
}

describe("one-shot CLI commands, run as a process", () => {
  let dir;
  let agentDir;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pi-cli-commands-"));
    agentDir = path.join(dir, "agent");
    // login and logout start from a configuration like the server does; an empty one is the defaults.
    await writeFile(path.join(dir, "pi-outpost.config.json"), "{}\n");
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const authFile = () => path.join(agentDir, "auth.json");
  const auth = () => (existsSync(authFile()) ? JSON.parse(readFileSync(authFile(), "utf8")) : {});

  test("--help prints the commands and exits 0, without starting a server", async () => {
    const { code, out } = await cli(["--help"], { cwd: dir });
    assert.equal(code, 0, out);
    assert.match(out, /login/);
    assert.match(out, /build-exe/);
    assert.doesNotMatch(out, /\[server\]/, "no server log line: nothing was started");
  });

  test("--version prints the version and exits 0", async () => {
    const { code, out } = await cli(["--version"], { cwd: dir });
    assert.equal(code, 0, out);
    // The release build injects the package version; run from source it says so instead.
    assert.equal(out.trim().split(/\r?\n/).at(-1), "dev");
  });

  test("build-exe refuses to replace an existing file without --force, and leaves it", async () => {
    const target = path.join(dir, "existing-exe");
    await writeFile(target, "keep me");
    const { code, out } = await cli(["build-exe", "--out", target], { cwd: dir });
    assert.equal(code, 1, out);
    assert.match(out, /already exists — pass --force to replace it/);
    assert.equal(readFileSync(target, "utf8"), "keep me");
  });

  test("config --confine with no configuration file says init writes one, and creates nothing", async () => {
    const empty = await mkdtemp(path.join(dir, "no-config-"));
    const { code, out } = await cli(["config", "--confine", "--agent-dir", agentDir], { cwd: empty });
    assert.equal(code, 0, out);
    assert.match(out, /No configuration file, so nothing to change/);
    assert.match(out, /pi-outpost init/);
    assert.deepEqual(readdirSync(empty), [], "nothing is written");
  });

  test("config --confine with the shell off leaves the file as it was", async () => {
    const project = await mkdtemp(path.join(dir, "shell-off-"));
    const file = path.join(project, "pi-outpost.config.json");
    const text = '{ "sandbox": { "allowBash": false } }\n';
    await writeFile(file, text);
    const { code, out } = await cli(["config", "--confine", "--agent-dir", agentDir], { cwd: project });
    assert.equal(code, 0, out);
    assert.match(out, /unchanged/);
    assert.match(out, /The shell is off .* nothing to confine/);
    assert.equal(readFileSync(file, "utf8"), text);
  });

  describe("login and logout", () => {
    test("login without a provider is refused with how to name one", async () => {
      const { code, out } = await cli(["login", "--agent-dir", agentDir], { cwd: dir });
      assert.equal(code, 1, out);
      assert.match(out, /login needs a provider: pi-outpost login --provider anthropic/);
      assert.ok(!existsSync(authFile()));
    });

    test("an unknown provider is refused with the known ones, and nothing is stored", async () => {
      const { code, out } = await cli(["login", "--provider", "no-such-provider", "--agent-dir", agentDir], {
        cwd: dir,
        input: "sk-never-stored\n",
      });
      assert.equal(code, 1, out);
      assert.match(out, /unknown provider "no-such-provider" — known: .*anthropic/);
      assert.ok(!existsSync(authFile()) || !JSON.stringify(auth()).includes("sk-never-stored"));
    });

    test("a piped key is stored in this configuration's agent directory", async () => {
      const { code, out } = await cli(["login", "--provider", "anthropic", "--agent-dir", agentDir], {
        cwd: dir,
        input: "sk-test-piped-key\n",
      });
      assert.equal(code, 0, out);
      assert.match(out, /stored anthropic credentials in/);
      assert.match(JSON.stringify(auth().anthropic), /sk-test-piped-key/);
    });

    test("logout removes the stored credential and says environment ones were left", async () => {
      const { code, out } = await cli(["logout", "--provider", "anthropic", "--agent-dir", agentDir], { cwd: dir });
      assert.equal(code, 0, out);
      assert.match(out, /signed out of anthropic; environment credentials were left untouched/);
      assert.equal(auth().anthropic, undefined);
    });

    test("logout without a provider is refused", async () => {
      const { code, out } = await cli(["logout", "--agent-dir", agentDir], { cwd: dir });
      assert.equal(code, 1, out);
      assert.match(out, /logout needs a provider/);
    });
  });
});
