/**
 * Contract tests for the optional Pi RPC runtime.
 *
 * The child is a real subprocess speaking LF-delimited JSONL. Only its answers
 * are scripted, so these tests cover spawning, framing, correlation, lifecycle,
 * state folding and fail-closed behavior at the actual process boundary.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fsNative from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import type { AgentRuntime, RuntimeEvent } from "../src/agentRuntime.ts";
import type { AgentRuntimeConfig } from "../src/config.ts";
import { agentDirEnv } from "../src/piRpcProcess.ts";
import { createRpcRuntime } from "../src/rpcRuntime.ts";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));
const roots = new Set<string>();
const runtimes = new Set<AgentRuntime>();

afterEach(async () => {
  await Promise.all([...runtimes].map((runtime) => runtime.dispose().catch(() => {})));
  runtimes.clear();
  // Retries because Windows keeps a directory locked for a moment after the process
  // that had it as its working directory exits. `dispose()` above already waits for
  // the child to be gone; this covers the tail of the OS releasing the handle.
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })));
  roots.clear();
});

function settings(overrides: Partial<AgentRuntimeConfig> = {}): AgentRuntimeConfig {
  return {
    mode: "rpc",
    executable: process.execPath,
    args: [FAKE],
    startupTimeoutMs: 2_000,
    commandTimeoutMs: 500,
    shutdownGraceMs: 100,
    ...overrides,
  };
}

interface RunningFake {
  runtime: AgentRuntime;
  root: string;
  launchLog: string;
  commandLog: string;
}

async function startFake(config: Record<string, unknown> = {}, overrides: Partial<AgentRuntimeConfig> = {}): Promise<RunningFake> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-rpc-"));
  roots.add(root);
  const launchLog = path.join(root, "launch.json");
  const commandLog = path.join(root, "commands.jsonl");
  const configPath = path.join(root, "fake.json");
  await writeFile(configPath, JSON.stringify({ launchLog, commandLog, ...config }));

  const previous = process.env.FAKE_PI_RPC_CONFIG;
  process.env.FAKE_PI_RPC_CONFIG = configPath;
  try {
    const runtime = await createRpcRuntime({
      settings: settings(overrides),
      cwd: root,
      agentDir: path.join(root, "agent"),
      sessionDir: path.join(root, "sessions"),
    });
    runtimes.add(runtime);
    return { runtime, root, launchLog, commandLog };
  } finally {
    if (previous === undefined) delete process.env.FAKE_PI_RPC_CONFIG;
    else process.env.FAKE_PI_RPC_CONFIG = previous;
  }
}

function waitForEvent(
  runtime: AgentRuntime,
  matches: (event: RuntimeEvent) => boolean,
  timeoutMs = 2_000,
): Promise<RuntimeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("timed out waiting for runtime event"));
    }, timeoutMs);
    const unsubscribe = runtime.subscribe((event) => {
      if (!matches(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

/** Signal 0 asks "is this pid still there?" without touching the process. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll a condition rather than sleeping a guessed interval.
 *
 * The window is generous because the thing usually being waited on is the OS: a
 * killed child is briefly still a pid (unreaped) after it has stopped running, and
 * a loaded CI runner stretches that. A tight bound here fails a correct
 * implementation, which is the worst kind of test.
 */
async function waitFor(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function commands(pathname: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(pathname, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * The SDK builds this variable's name from its own package identity. A fork that
 * renames itself reads a different one and would fall back to its own default
 * directory — its own credentials and models.json — while pi-outpost went on
 * logging and reporting the agentDir it thought it had set.
 */
describe("agentDirEnv", () => {
  test("always sets the canonical name, which today reaches pi, omp and little-coder", () => {
    assert.equal(agentDirEnv("/usr/bin/pi", "/agent").PI_CODING_AGENT_DIR, "/agent");
  });

  test("adds a name derived from the executable, for a fork that renamed itself", () => {
    assert.deepEqual(agentDirEnv("/usr/local/bin/little-coder", "/agent"), {
      PI_CODING_AGENT_DIR: "/agent",
      LITTLE_CODER_CODING_AGENT_DIR: "/agent",
    });
  });

  test("does not duplicate the canonical name for pi itself", () => {
    assert.deepEqual(Object.keys(agentDirEnv("pi", "/agent")), ["PI_CODING_AGENT_DIR"]);
  });

  test("strips a Windows extension rather than baking it into the variable", () => {
    assert.ok("OMP_CODING_AGENT_DIR" in agentDirEnv("C:\\tools\\omp.exe", "/agent"));
  });

  test("never emits a name that is not a legal variable", () => {
    for (const name of Object.keys(agentDirEnv("/opt/2-weird.name/agent!", "/agent"))) {
      assert.match(name, /^[A-Z][A-Z0-9_]*$/, `"${name}" is not a usable environment variable name`);
    }
  });
});

describe("RpcRuntimeStarts", () => {
  test("bootstraps the snapshot before returning and owns the RPC launch arguments", async () => {
    const message = { role: "assistant", content: [{ type: "text", text: "existing answer" }] };
    const entry = { type: "message", id: "entry-1", message: { role: "user", content: "existing question" } };
    const { runtime, root, launchLog, commandLog } = await startFake({
      state: {
        sessionId: "rpc-session",
        sessionFile: "/sessions/rpc-session.jsonl",
        thinkingLevel: "high",
        model: { provider: "omp", id: "little-coder", name: "Little Coder", reasoning: true },
      },
      messages: [message],
      entries: [entry],
      tree: [{ entry, children: [] }],
      leafId: "entry-1",
      models: [{ provider: "omp", id: "little-coder", name: "Little Coder", reasoning: true }],
      commands: [{ name: "review", description: "Review it", source: "skill" }],
    });

    assert.deepEqual(runtime.snapshot(), {
      sessionId: "rpc-session",
      sessionFile: "/sessions/rpc-session.jsonl",
      model: { provider: "omp", id: "little-coder", name: "Little Coder", reasoning: true },
      thinkingLevel: "high",
      isStreaming: false,
      messages: [message],
      models: [{ provider: "omp", id: "little-coder", name: "Little Coder", reasoning: true }],
      commands: [{ name: "review", description: "Review it", source: "skill" }],
      contextUsage: { tokens: 10, contextWindow: 1000, percent: 1 },
      providers: [],
    });
    assert.deepEqual(runtime.tree(), { roots: [{ entry, children: [] }], leafId: "entry-1" });
    assert.deepEqual(runtime.contextEntries(), [entry]);

    const launch = JSON.parse(await readFile(launchLog, "utf8"));
    // Canonicalized on both sides: macOS reaches /var through a symlink to
    // /private/var, and Windows hands the child the 8.3 short form of a %TEMP% path.
    assert.equal(launch.cwd, fsNative.realpathSync.native(root));
    assert.equal(launch.agentDir, path.join(root, "agent"));
    assert.deepEqual(launch.argv, ["--session-dir", path.join(root, "sessions"), "--mode", "rpc"]);
    assert.deepEqual(
      (await commands(commandLog)).map((command) => command.type),
      [
        "get_state",
        "get_available_models",
        "get_commands",
        "get_available_thinking_levels",
        "get_messages",
        "get_tree",
        "get_entries",
        "get_session_stats",
      ],
    );
  });

  /**
   * The child is killed on every failure and on shutdown, so it must not be
   * collecting coverage into the parent's directory: a truncated file there makes
   * the reporter fail a run whose tests all passed, blaming a JSON syntax error at
   * a buffer boundary — which names nothing that leads back to here. It cost a CI
   * run to find once.
   */
  test("keeps the child out of the parent's coverage collection", async () => {
    const { launchLog } = await startFake({});
    const launch = JSON.parse(await readFile(launchLog, "utf8"));
    assert.equal(launch.coverageDir, null, "NODE_V8_COVERAGE must not reach the agent child");
  });

  test("reports an actionable startup failure instead of falling back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-rpc-startup-"));
    roots.add(root);
    await assert.rejects(
      createRpcRuntime({
        settings: settings({ executable: path.join(root, "missing-pi") }),
        cwd: root,
        agentDir: path.join(root, "agent"),
      }),
      /Pi RPC runtime failed to start.*could not start.*missing-pi/,
    );
  });

  /**
   * A fork that lacks a flag names the flag; the operator wrote a setting. The
   * bridge between the two lives in the startup error, and it silently stopped
   * working when the child's output was split out of the client-facing cause —
   * the string being scanned could no longer contain a flag name. Only a test
   * that goes through the real startup path catches that; the unit test for
   * `explainRejectedFlags` kept passing on a string nobody was passing it.
   */
  test("names the setting behind a flag the executable rejected", async () => {
    await assert.rejects(
      startFake({ startupFailure: "Error: unknown flag: --skill\nRun `omp --help` for available flags.", startupExitCode: 2 }),
      /--skill \(from "skillPaths/,
    );
  });

  test("accepts a runtime without the optional command catalog", async () => {
    const { runtime } = await startFake({
      failures: {
        get_commands: "Unknown command: get_commands",
        get_available_commands: "Unknown command: get_available_commands",
      },
      omitResponseIdsFor: ["get_commands", "get_available_commands"],
    });
    assert.deepEqual(runtime.snapshot().commands, []);
    assert.equal(runtime.ok, true);
  });

  test("carries the model's accepted thinking levels when the child reports them", async () => {
    const { runtime } = await startFake({
      commands_: { get_available_thinking_levels: { data: { levels: ["low", "medium", "xhigh", "bogus"] } } },
    });
    // sanitised: unknown name dropped, canonical order, `off` ensured
    assert.deepEqual(runtime.snapshot().thinkingLevels, ["off", "low", "medium", "xhigh"]);
  });

  test("keeps what the catalog says a model reasons when set_model does not repeat it", async () => {
    // The server reads `reasoning` off this answer to decide whether a thinking
    // control exists at all. A dialect that answers `set_model` with nothing would
    // otherwise take the control away from a model that reasons perfectly well.
    const { runtime } = await startFake({
      models: [
        { provider: "fake", id: "one", name: "One", reasoning: true },
        { provider: "fake", id: "two", name: "Two", reasoning: true },
      ],
      commands_: { set_model: { data: null } },
    });

    const model = await runtime.setModel("fake", "two");
    assert.equal(model.reasoning, true);
    assert.equal(runtime.snapshot().model?.reasoning, true);
  });

  test("re-reads the level the child clamped when the model changed", async () => {
    // The child clamps inside `set_model` and emits nothing: RPC has no
    // thinking-level record. A mirror that only updates on `set_thinking_level`
    // keeps reporting the previous model's level for a model that never took it.
    const { runtime } = await startFake({
      state: {
        thinkingLevel: "high",
        model: { provider: "fake", id: "thinker", name: "Thinker", reasoning: true },
      },
      models: [
        { provider: "fake", id: "thinker", name: "Thinker", reasoning: true },
        { provider: "fake", id: "plain", name: "Plain", reasoning: false },
      ],
      thinkingLevelsByModel: { "fake/thinker": ["off", "low", "medium", "high"], "fake/plain": ["off"] },
    });
    assert.equal(runtime.snapshot().thinkingLevel, "high");

    await runtime.setModel("fake", "plain");
    assert.equal(runtime.snapshot().thinkingLevel, "off");
    assert.deepEqual(runtime.snapshot().thinkingLevels, ["off"]);
  });

  test("omits the accepted levels when the child has no command for them", async () => {
    const { runtime } = await startFake({
      failures: { get_available_thinking_levels: "Unknown command: get_available_thinking_levels" },
      omitResponseIdsFor: ["get_available_thinking_levels"],
    });
    assert.equal(runtime.snapshot().thinkingLevels, undefined);
    assert.equal(runtime.ok, true);
  });

  test("uses OMP's command catalog and active-branch dialect without inventing ids", async () => {
    const { runtime, commandLog } = await startFake({
      failures: { get_commands: "Unknown command: get_commands", get_tree: "Unknown command: get_tree" },
      omitResponseIdsFor: ["get_commands", "get_tree"],
      commands_: {
        get_available_commands: {
          data: { commands: [{ name: "review", description: "Review", source: "extension", input: { hint: "<path>" } }] },
        },
        get_branch_messages: {
          data: { messages: [{ entryId: "user-1", text: "first" }, { entryId: "user-2", text: "second" }] },
        },
        branch: { data: { cancelled: true, text: "second" } },
        prompt: { after: [{ type: "agent_start" }, { type: "agent_end", messages: [] }] },
      },
    });
    assert.deepEqual(runtime.snapshot().commands, [
      { name: "review", description: "Review", argumentHint: "<path>", source: "extension" },
    ]);
    assert.deepEqual(runtime.entries().map((entry) => entry.id), ["user-1", "user-2"]);
    assert.equal(runtime.tree().roots[0]?.children[0]?.entry.id, "user-2");
    assert.equal(runtime.tree().leafId, "user-2");
    assert.deepEqual(await runtime.fork("user-2"), { cancelled: true, selectedText: "second" });
    assert.ok((await commands(commandLog)).some((command) => command.type === "branch" && command.entryId === "user-2"));

    const completed = waitForEvent(runtime, (event) => event.type === "agent_end");
    await runtime.prompt("finish on OMP's terminal event");
    await completed;
    assert.equal(runtime.snapshot().isStreaming, false);
  });

  test("derives entries from the required tree when get_entries is unavailable", async () => {
    const entry = { type: "message", id: "tree-entry", message: { role: "user", content: "from tree" } };
    const { runtime } = await startFake({
      tree: [{ entry, children: [] }],
      leafId: "tree-entry",
      failures: { get_entries: "Unknown command: get_entries" },
      omitResponseIdsFor: ["get_entries"],
    });
    assert.deepEqual(runtime.entries(), [entry]);
    assert.deepEqual(runtime.contextEntries(), [entry]);
  });

  /**
   * Whether a command is absent or the transport is broken decides between
   * degrading and failing closed, and the only evidence is prose an agent wrote.
   * Matching one exact sentence turned an intended degradation into a hard failure
   * on any fork that words it differently.
   */
  for (const wording of ["Unknown command: get_tree", "Unknown command 'get_tree'", "unsupported command: get_tree", "get_tree is not supported"]) {
    test(`degrades gracefully when a fork says "${wording}"`, async () => {
      const { runtime } = await startFake({
        failures: { get_tree: wording },
        omitResponseIdsFor: ["get_tree"],
        // Absent `get_tree` means the OMP dialect, whose active branch comes from here.
        commands_: { get_branch_messages: { data: { messages: [{ entryId: "user-1", text: "first" }] } } },
      });
      assert.equal(runtime.ok, true);
      assert.deepEqual(
        runtime.entries().map((entry) => entry.id),
        ["user-1"],
      );
    });
  }

  test("still fails closed when the error is not about the command being absent", async () => {
    await assert.rejects(
      startFake({ failures: { get_tree: "database is locked" } }),
      /failed to start.*database is locked/,
      "an error that merely mentions no command name must not be read as graceful absence",
    );
  });

  test("rejects a runtime missing a required bootstrap command", async () => {
    await assert.rejects(
      startFake({ failures: { get_messages: "Unknown command: get_messages" } }),
      /Pi RPC runtime failed to start.*Unknown command: get_messages/,
    );
  });
});

describe("strict RPC records and core interaction", () => {
  test("keeps a literal U+2028 inside one LF-delimited record and forwards images while steering", async () => {
    const separatorText = "before\u2028after";
    const update = {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: separatorText },
    };
    const { runtime, commandLog } = await startFake({
      state: { isStreaming: true },
      commands_: {
        prompt: {
          after: [
            `${JSON.stringify({ type: "message_start", message: { role: "assistant" } })}\n`,
            `${JSON.stringify(update)}\n`,
            {
              type: "message_end",
              message: { role: "assistant", content: [{ type: "text", text: separatorText }] },
            },
            { type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "README.md" } },
            {
              type: "tool_execution_end",
              toolCallId: "tool-1",
              toolName: "read",
              result: { content: [{ type: "text", text: "done" }] },
              isError: false,
            },
          ],
        },
      },
    });
    const observed: RuntimeEvent[] = [];
    const unsubscribe = runtime.subscribe((event) => observed.push(event));
    const delta = waitForEvent(runtime, (event) => event.type === "block_delta");
    const tool = waitForEvent(runtime, (event) => event.type === "tool_end");
    await runtime.prompt("look", { images: [{ mimeType: "image/png", data: "aGVsbG8=" }] });
    assert.deepEqual(await delta, { type: "block_delta", block: "text", contentIndex: 0, delta: separatorText });
    await tool;
    unsubscribe();
    assert.deepEqual(
      observed.map((event) => event.type),
      ["assistant_start", "block_delta", "assistant_end", "tool_start", "tool_end"],
    );

    const prompt = (await commands(commandLog)).find((command) => command.type === "prompt");
    assert.equal(prompt?.message, "look");
    assert.equal(prompt?.streamingBehavior, "steer");
    assert.deepEqual(prompt?.images, [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
  });

  test("forwards a tool's completion fraction, and omits it when the tool sends none", async () => {
    const { runtime } = await startFake({
      state: { isStreaming: true },
      commands_: {
        prompt: {
          after: [
            { type: "tool_execution_start", toolCallId: "tool-1", toolName: "crawl", args: {} },
            {
              type: "tool_execution_update",
              toolCallId: "tool-1",
              partialResult: { content: [{ type: "text", text: "step 2" }], details: { progress: 0.4 } },
            },
            {
              type: "tool_execution_update",
              toolCallId: "tool-1",
              partialResult: { content: [{ type: "text", text: "step 3" }] },
            },
            {
              type: "tool_execution_end",
              toolCallId: "tool-1",
              toolName: "crawl",
              result: { content: [{ type: "text", text: "done" }] },
              isError: false,
            },
          ],
        },
      },
    });
    const updates: RuntimeEvent[] = [];
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === "tool_update") updates.push(event);
    });
    const ended = waitForEvent(runtime, (event) => event.type === "tool_end");
    await runtime.prompt("go");
    await ended;
    unsubscribe();

    assert.equal(updates.length, 2);
    assert.equal((updates[0] as { progress?: unknown }).progress, 0.4);
    assert.equal((updates[1] as { progress?: unknown }).progress, undefined);
  });

  test("round-trips an extension dialog answer with the original id", async () => {
    const { runtime, commandLog } = await startFake({
      dialogBlocksCommand: "prompt",
      commands_: {
        prompt: { before: [{ type: "extension_ui_request", id: "dialog-7", method: "input", title: "Name?" }] },
      },
    }, { commandTimeoutMs: 40 });
    const request = waitForEvent(runtime, (event) => event.type === "extension_ui_request");
    const prompt = runtime.prompt("ask me");
    assert.deepEqual(await request, {
      type: "extension_ui_request",
      request: { type: "extension_ui_request", id: "dialog-7", method: "input", title: "Name?" },
    });

    const answered = waitForEvent(runtime, (event) => event.type === "error" && event.message.includes("answered:dialog-7:Laurent"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(runtime.ok, true, "a prompt blocked on browser input must not time out");
    runtime.answerExtensionUI({ type: "extension_ui_response", id: "dialog-7", value: "Laurent" });
    await answered;
    await prompt;
    assert.deepEqual(
      (await commands(commandLog)).find((command) => command.type === "extension_ui_response"),
      { type: "extension_ui_response", id: "dialog-7", value: "Laurent" },
    );
  });

  test("rebootstraps state and tree after switching sessions", async () => {
    const replacementEntry = { type: "message", id: "new-entry", message: { role: "user", content: "new session" } };
    const { runtime } = await startFake({
      commands_: {
        switch_session: {
          data: { cancelled: false },
          replacement: {
            state: { sessionId: "session-2", sessionFile: "/sessions/session-2.jsonl" },
            messages: [replacementEntry.message],
            entries: [replacementEntry],
            tree: [{ entry: replacementEntry, children: [] }],
            leafId: "new-entry",
          },
        },
      },
    });
    const replaced = waitForEvent(runtime, (event) => event.type === "session_replaced");
    assert.deepEqual(await runtime.switchSession("/sessions/session-2.jsonl"), { cancelled: false });
    await replaced;
    assert.equal(runtime.snapshot().sessionId, "session-2");
    assert.equal(runtime.snapshot().sessionFile, "/sessions/session-2.jsonl");
    assert.equal(runtime.tree().leafId, "new-entry");
    assert.deepEqual(runtime.contextEntries(), [replacementEntry]);
  });
});

describe("RpcProcessFailureIsContained", () => {
  test("fails closed on a malformed record and refuses later commands", async () => {
    const { runtime } = await startFake({ malformedAfter: "prompt", malformedLine: "{definitely not json" });
    const failed = waitForEvent(runtime, (event) => event.type === "runtime_failed");
    await runtime.prompt("first");
    const event = await failed;
    assert.match(event.type === "runtime_failed" ? event.message : "", /record that is not JSON/);
    assert.equal(runtime.ok, false);
    await assert.rejects(runtime.prompt("second"), /record that is not JSON/);
  });

  test("fails closed when the child exits unexpectedly", async () => {
    const { runtime } = await startFake({ exitAfter: "prompt", exitCode: 23 });
    const failed = waitForEvent(runtime, (event) => event.type === "runtime_failed");
    await runtime.prompt("accepted before exit");
    const event = await failed;
    assert.match(event.type === "runtime_failed" ? event.message : "", /exit code 23/);
    assert.equal(runtime.ok, false);
  });

  test("bounds a command that never answers and makes the timeout terminal", async () => {
    const { runtime } = await startFake({ stallCommand: "prompt" }, { commandTimeoutMs: 40 });
    const failed = waitForEvent(runtime, (event) => event.type === "runtime_failed");
    const started = Date.now();
    await assert.rejects(runtime.prompt("stalled"), /timed out/);
    assert.ok(Date.now() - started < 1_000);
    const event = await failed;
    assert.match(event.type === "runtime_failed" ? event.message : "", /did not answer the prompt command within 40 ms/);
    assert.equal(runtime.ok, false);
  });

  /**
   * "Fail closed" has to mean the process with the side effects, not just the
   * protocol. A stalled command used to leave the server refusing every browser
   * command while pi kept running tools against the workspace, unsupervised.
   */
  test("kills the child when the runtime fails, rather than leaving it running", async () => {
    const { runtime, launchLog } = await startFake({ stallCommand: "prompt", ignoreSigterm: false }, { commandTimeoutMs: 40 });
    const failed = waitForEvent(runtime, (event) => event.type === "runtime_failed");
    await assert.rejects(runtime.prompt("stalled"), /timed out/);
    await failed;
    const { pid } = JSON.parse(await readFile(launchLog, "utf8"));
    await waitFor(() => !isAlive(pid), "the child to be terminated after the runtime failed");
  });

  test("a failure carries the cause to clients and the child's output only to the log", async () => {
    const noise = "Error: ENOENT /Users/someone/secret/path\n    at Object.<anonymous>";
    const { runtime } = await startFake({ exitAfter: "prompt", exitCode: 23, stderrOnStart: noise });
    const failed = waitForEvent(runtime, (event) => event.type === "runtime_failed");
    await runtime.prompt("go");
    const event = await failed;
    const message = event.type === "runtime_failed" ? event.message : "";
    assert.match(message, /exit code 23/, "the cause must reach the browser");
    // Absolute paths and stack traces are exactly what redactRpcCommand and
    // credentialStatus withhold from clients elsewhere.
    assert.equal(message.includes("secret/path"), false, `the child's stderr must not reach clients: ${message}`);
  });

  test("refuses an answer to a dialog it is not waiting on", async () => {
    const { runtime, commandLog } = await startFake({});
    runtime.answerExtensionUI({ type: "extension_ui_response", id: "never-asked", value: "x" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      (await commands(commandLog)).some((command) => command.type === "extension_ui_response"),
      false,
      "an unsolicited answer must not be written to the child's stdin",
    );
  });

  test("force-terminates only its child when SIGTERM is ignored", async () => {
    // Same reason as childEnv in piRpcProcess.ts, and the same "" rather than a
    // delete: this node process is killed at the end, and an inherited
    // NODE_V8_COVERAGE would leave a half-written coverage file behind.
    const bystanderEnv = { ...process.env, NODE_V8_COVERAGE: "" };
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: bystanderEnv });
    const { runtime } = await startFake({ ignoreSigterm: true }, { shutdownGraceMs: 40 });
    try {
      const started = Date.now();
      await runtime.dispose();
      runtimes.delete(runtime);
      assert.ok(Date.now() - started < 1_000, "dispose should be bounded by the configured grace period");
      assert.equal(unrelated.exitCode, null, "an unrelated process must still be running");
      assert.doesNotThrow(() => process.kill(unrelated.pid!, 0));
    } finally {
      unrelated.kill("SIGTERM");
      await new Promise((resolve) => unrelated.once("exit", resolve));
    }
  });
});
