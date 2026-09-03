#!/usr/bin/env node
/**
 * A controllable stand-in for `pi --mode rpc`.
 *
 * Speaks the real framing (LF-only JSONL, both directions) and the real
 * command/response/event vocabulary, but every answer is scripted from a JSON
 * file named by FAKE_PI_RPC_CONFIG. That is what lets a test drive the cases a
 * real Pi will not produce on demand: a record split across two chunks, a line
 * containing U+2028, malformed output, a stalled command, an unexpected exit.
 *
 * It asserts one thing on its own: that `--mode rpc` arrived. A fake that served
 * the protocol regardless would hide the very bug the "pi-outpost owns the mode
 * flag" decision exists to prevent.
 */
import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

const config = JSON.parse(fs.readFileSync(process.env.FAKE_PI_RPC_CONFIG, "utf8"));
const argv = process.argv.slice(2);

/** Everything the harness wants to inspect about how it was launched. */
const launch = {
  argv,
  // `realpath.native` because Windows hands a child the 8.3 short form of its own
  // working directory when the path came from %TEMP% — "C:\Users\RUNNER~1\..."
  // against the caller's "C:\Users\runneradmin\...". Same directory, different
  // string; canonicalize both sides rather than comparing spellings.
  cwd: fs.realpathSync.native(process.cwd()),
  agentDir: process.env.PI_CODING_AGENT_DIR,
  // The settings pi-outpost's own tools extension reads. Logged so a test can
  // prove the child was told where the workspace is, not merely handed the file.
  toolsEnv: process.env.PI_OUTPOST_TOOLS,
  // Must be empty or absent: a child that inherits a real path writes into the
  // parent's coverage directory, and this child gets killed. Node re-injects the
  // variable, so "" is the disabled state, not the missing one.
  coverageDir: process.env.NODE_V8_COVERAGE || null,
  pid: process.pid,
};
if (config.launchLog) fs.writeFileSync(config.launchLog, JSON.stringify(launch, null, 2));

const modeAt = argv.lastIndexOf("--mode");
if (modeAt === -1 || argv[modeAt + 1] !== "rpc") {
  process.stderr.write("fake-pi-rpc: refusing to start without --mode rpc\n");
  process.exit(2);
}

if (config.startupFailure) {
  process.stderr.write(`${config.startupFailure}\n`);
  process.exit(config.startupExitCode ?? 1);
}

// --- writing ---------------------------------------------------------------

function emit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/** Raw bytes, so a test can send a half-record, a CRLF line, or plain garbage. */
function emitRaw(text) {
  process.stdout.write(text);
}

function emitAll(records) {
  for (const record of records ?? []) {
    if (typeof record === "string") emitRaw(record);
    else emit(record);
  }
}

// --- state -----------------------------------------------------------------

const state = {
  model: { provider: "fake", id: "fake-1", name: "Fake One", reasoning: true },
  thinkingLevel: "off",
  isStreaming: false,
  sessionId: "session-1",
  sessionFile: "/tmp/fake-session-1.jsonl",
  ...(config.stateByCwd?.[launch.cwd] ?? config.state),
};
let messages = config.messages ?? [];
let entries = config.entries ?? [];
let tree = config.tree ?? [];
let leafId = config.leafId ?? null;

/** Per-command scripted data, replaced wholesale by a `switch_session`/`new_session`. */
function applyReplacement(replacement) {
  if (!replacement) return;
  Object.assign(state, replacement.state ?? {});
  if (replacement.messages) messages = replacement.messages;
  if (replacement.entries) entries = replacement.entries;
  if (replacement.tree) tree = replacement.tree;
  if (replacement.leafId !== undefined) leafId = replacement.leafId;
}

const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** What this child accepts for a model, where the test declares it per model. */
function acceptedThinkingLevels(model) {
  return config.thinkingLevelsByModel?.[`${model?.provider}/${model?.id}`];
}

/**
 * What the real child does inside `set_model`: the session's level is clamped to
 * the new model's scale — nearest level below, else the nearest above — and no
 * record is emitted to say so.
 */
function clampToModel() {
  const levels = acceptedThinkingLevels(state.model);
  if (!levels || levels.includes(state.thinkingLevel)) return;
  const index = THINKING_ORDER.indexOf(state.thinkingLevel);
  state.thinkingLevel =
    THINKING_ORDER.slice(0, Math.max(0, index)).reverse().find((level) => levels.includes(level)) ??
    THINKING_ORDER.slice(index + 1).find((level) => levels.includes(level)) ??
    levels[0] ??
    "off";
}

const DATA = {
  get_state: () => ({ ...state }),
  get_messages: () => ({ messages }),
  get_entries: () => ({ entries, leafId }),
  get_tree: () => ({ tree, leafId }),
  get_session_stats: () => config.stats ?? { contextUsage: { tokens: 10, contextWindow: 1000, percent: 1 } },
  get_available_models: () => ({ models: config.models ?? [state.model] }),
  get_commands: () => ({ commands: config.commands ?? [] }),
  // rpc-mode answers `set_model` with the model itself, `reasoning` included — the
  // server reads that field to decide whether a thinking control exists at all.
  set_model: () => ({ ...state.model }),
  get_available_thinking_levels: () => {
    const levels = acceptedThinkingLevels(state.model);
    return levels ? { levels } : undefined;
  },
};

// --- reading ---------------------------------------------------------------

const seen = [];
const commandCounts = new Map();
let pendingDialogCommand;

function recordCommand(command) {
  seen.push(command);
  if (config.commandLog) fs.appendFileSync(config.commandLog, `${JSON.stringify(command)}\n`);
}

function handle(command) {
  const type = command.type;
  if (type === "extension_ui_response") {
    recordCommand(command);
    // Nothing answers this — surface it as an event so a test can see the answer
    // came back correlated to the request that blocked.
    const value = "cancelled" in command ? "cancelled" : "confirmed" in command ? String(command.confirmed) : String(command.value);
    emit({ type: "extension_error", extensionPath: "dialog", error: `answered:${command.id}:${value}` });
    if (pendingDialogCommand) {
      emit({ id: pendingDialogCommand.id, type: "response", command: pendingDialogCommand.type, success: true });
      pendingDialogCommand = undefined;
    }
    return;
  }
  recordCommand(command);

  const scripted = config.commands_ ?? {};
  const configured = scripted[type];
  const count = commandCounts.get(type) ?? 0;
  commandCounts.set(type, count + 1);
  const script = Array.isArray(configured) ? configured[Math.min(count, configured.length - 1)] : configured;
  const responseId = (config.omitResponseIdsFor ?? []).includes(type) ? {} : { id: command.id };

  if (config.stallCommand === type) return; // never answer: exercises the command timeout

  if (config.exitBefore === type) {
    process.exit(config.exitCode ?? 7);
  }

  emitAll(script?.before);

  const failure = config.failures?.[type];
  if (failure !== undefined) {
    emit({ ...responseId, type: "response", command: type, success: false, error: failure });
    emitAll(script?.after);
    return;
  }

  // Keep a command in flight while another client reaches the server. This is
  // used for replacement-lock races that cannot be reproduced with an
  // immediate scripted response.
  if (script?.delayMs !== undefined) {
    setTimeout(() => finishSuccessfulCommand(command, type, script, responseId), script.delayMs);
    return;
  }

  if (config.dialogBlocksCommand === type) {
    pendingDialogCommand = command;
    return;
  }

  finishSuccessfulCommand(command, type, script, responseId);
}

function finishSuccessfulCommand(command, type, script, responseId) {
  // Commands that change what the state queries return
  if (type === "set_model") {
    state.model = { provider: command.provider, id: command.modelId, name: command.modelId, reasoning: true };
    clampToModel();
  }
  if (type === "set_thinking_level") state.thinkingLevel = command.level;
  if (type === "set_session_name") state.sessionName = command.name;
  if (type === "prompt" || type === "steer") state.isStreaming = true;
  applyReplacement(script?.replacement);

  const data = script && "data" in script ? script.data : DATA[type]?.();
  emit({ ...responseId, type: "response", command: type, success: true, ...(data === undefined ? {} : { data }) });

  for (const write of script?.writes ?? []) fs.writeFileSync(write.path, write.content);
  emitAll(script?.after);
  if (config.malformedAfter === type) emitRaw(`${config.malformedLine ?? "{not json"}\n`);
  if (type === "prompt" && config.progressDemo) emitProgressDemo(config.progressDemo);
  if (config.exitAfter === type) process.exit(config.exitCode ?? 7);
}

/**
 * A tool call that reports its completion fraction, for the running-app check.
 *
 * `{ steps: n, intervalMs: ms, toolName, error: bool }` — emits a start, `n`
 * spaced `tool_execution_update` records whose `partialResult.details.progress`
 * climbs from `1/n` to `1`, then an end. The real thing an extension tool does
 * through `onUpdate`, without a model in the loop.
 */
function emitProgressDemo({ steps = 4, intervalMs = 400, toolName = "crawl", error = false } = {}) {
  const toolCallId = `progress-demo-${Date.now()}`;
  emit({ type: "agent_start" });
  emit({ type: "tool_execution_start", toolCallId, toolName, args: {} });
  for (let i = 1; i <= steps; i++) {
    setTimeout(() => {
      emit({
        type: "tool_execution_update",
        toolCallId,
        partialResult: { content: [{ type: "text", text: `step ${i}/${steps}` }], details: { progress: i / steps } },
      });
    }, intervalMs * i);
  }
  setTimeout(() => {
    emit({
      type: "tool_execution_end",
      toolCallId,
      toolName,
      result: { content: [{ type: "text", text: error ? "failed" : "done" }] },
      isError: error,
    });
    emit({ type: "agent_end" });
    state.isStreaming = false;
  }, intervalMs * (steps + 1));
}

const decoder = new StringDecoder("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) break;
    let line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.length === 0) continue;
    try {
      handle(JSON.parse(line));
    } catch (error) {
      emit({ type: "response", command: "parse", success: false, error: `Failed to parse command: ${error.message}` });
    }
  }
});

// A child that ignores SIGTERM is how the bounded-shutdown path gets exercised.
if (config.ignoreSigterm) process.on("SIGTERM", () => {});

process.stdin.on("end", () => {
  if (!config.ignoreSigterm) process.exit(0);
});

// Noise on stderr, for asserting what does and does not reach a browser.
if (config.stderrOnStart) process.stderr.write(`${config.stderrOnStart}\n`);

emitAll(config.emitOnStart);
