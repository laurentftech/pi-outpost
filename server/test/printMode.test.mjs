/**
 * `pi-outpost -p`: one turn without a browser, through the real server, as a user runs it.
 *
 * Each test runs the CLI as a process, with a provider that answers what the test needs
 * (`fixtures/bash-call-provider.mjs`), and reads stdout, stderr and the exit status apart.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = path.join(SERVER, "src", "index.ts");
const PROVIDER = fileURLToPath(new URL("./fixtures/bash-call-provider.mjs", import.meta.url));
const MODEL = "bash-call-test/bash-call-test";

/** Runs `pi-outpost <args>` and resolves with what a shell would see, stdout and stderr apart. */
function print(args, { config, env = {}, stdin } = {}) {
  return new Promise((resolve) => {
    // Resolved from here: the process starts in the test's own folder, where a bare "tsx" is not found.
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), ENTRY, ...args, "--config", config], {
      cwd: path.dirname(config),
      env: { ...process.env, PI_OUTPOST_CONFIG: undefined, PI_OUTPOST_PROFILE: undefined, PI_OFFLINE: "1", ...env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
    // A hang must fail the test, not the job.
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("pi-outpost -p", () => {
  let dir;
  let config;
  before(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "print-mode-")));
    await mkdir(path.join(dir, ".openlore"));
    await writeFile(path.join(dir, ".openlore", "config.json"), '{"version":"1.0.0"}');
    config = path.join(dir, "pi-outpost.json");
    await writeFile(
      config,
      JSON.stringify({
        cwd: dir,
        agentDir: path.join(dir, ".pi-agent"),
        extensionPaths: [PROVIDER],
        allowedModels: [{ provider: "bash-call-test", id: "bash-call-test" }],
        noSkills: true,
        noPromptTemplates: true,
        webContext: false,
        openBrowser: false,
      }),
    );
  });
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  // openlore: scenario=APromptIsAnsweredOnStdout spec=cli
  test("APromptIsAnsweredOnStdout: the answer alone on stdout, the server's log on stderr, exit 0", { timeout: 150_000 }, async () => {
    const { code, stdout, stderr } = await print(["-p", "Say hello", "--model", MODEL], { config, env: { BASH_CALL_STEPS: "[]" } });
    assert.equal(code, 0, stderr);
    assert.equal(stdout, "done\n");
    assert.match(stderr, /\[server\] http:\/\/127\.0\.0\.1:\d+\//, "the server it ran, on a loopback port of its own");
    assert.doesNotMatch(stdout, /\[server\]|\[pi\]|\[config\]/);
  });

  // openlore: scenario=APromptFromStdin spec=cli
  test("APromptFromStdin: -p - reads the prompt from stdin", { timeout: 150_000 }, async () => {
    const { code, stdout } = await print(["-p", "-", "--json", "--model", MODEL], { config, env: { BASH_CALL_STEPS: "[]" }, stdin: "the prompt from stdin\n" });
    assert.equal(code, 0);
    const events = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === "user" && event.text === "the prompt from stdin"), "the turn's prompt is stdin's");
  });

  // openlore: scenario=AFailedTurnExitsNonZero spec=cli
  test("AFailedTurnExitsNonZero: a provider that fails the turn: the error on stderr, exit 1", { timeout: 150_000 }, async () => {
    const { code, stdout, stderr } = await print(["-p", "Say hello", "--model", MODEL], { config, env: { BASH_CALL_FAIL: "provider down" } });
    assert.equal(code, 1, stderr);
    assert.match(stderr, /\[pi-outpost\] the turn failed: .*provider down/);
    assert.equal(stdout.trim(), "");
  });

  // openlore: scenario=JsonPrintsTheTurnsEvents spec=cli
  test("JsonPrintsTheTurnsEvents: every line is JSON, the turn's start, message and end among them", { timeout: 150_000 }, async () => {
    const { code, stdout } = await print(["-p", "Say hello", "--json", "--model", MODEL], { config, env: { BASH_CALL_STEPS: "[]" } });
    assert.equal(code, 0);
    const types = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line).type);
    for (const type of ["agent_start", "assistant_end", "agent_end"]) assert.ok(types.includes(type), `${type} missing: ${types.join(", ")}`);
    assert.ok(!types.includes(undefined));
  });

  test("a model that is not allowed is refused, and the turn exits 1 rather than waiting", { timeout: 150_000 }, async () => {
    const { code, stderr } = await print(["-p", "Say hello", "--model", "nobody/none"], { config, env: { BASH_CALL_STEPS: "[]" } });
    assert.equal(code, 1, stderr);
    assert.match(stderr, /\[pi-outpost\] /);
  });
});
