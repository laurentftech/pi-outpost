/**
 * What a turn that died of stack exhaustion leaves behind — which is almost
 * nothing, unless something writes it down.
 *
 * "Maximum call stack size exceeded" reaches the red bubble under an assistant
 * turn as eight words with no frame and no stack, and that is not pi-outpost
 * throwing information away. Every provider's stream loop ends in the same
 * catch:
 *
 *   catch (error) { output.errorMessage = error instanceof Error ? error.message
 *                                       : JSON.stringify(error) }
 *
 * The message is kept and the Error is dropped, so by the time `assistant_end`
 * crosses the runtime seam there is no `.stack` left to read anywhere in the
 * process. Two providers (pi-messages, openai-codex-responses) additionally
 * attach a diagnostic that does carry one; the Anthropic path does not. Logging
 * the error harder *from here* is not an option that exists: `normalizeProviderError`
 * hands back a flat struct with no stack in it, `after_provider_response` fires
 * before the stream is consumed, and V8 offers no hook at an Error's construction.
 *
 * There is one way in, and it is not from this file: `providerStackHook.mjs`
 * rewrites that catch as the module loads, in memory. It puts the stack on
 * stderr and attaches it to the assistant message as a diagnostic, which is
 * what an upstream fix would do — so the trace arrives in `turn.diagnostics`
 * of the record below, beside the census, instead of having to be matched to
 * it by timestamp across two streams. It is off unless asked for, and when a
 * census lands without one the headline names the flag that would have caught it.
 *
 * What is an option: a stack overflow is a deterministic function of its input,
 * so this records the input. The number that matters is **depth**. A recursive-
 * descent parser — and the request path is full of them, from the streaming
 * tool-argument parser to the JSON-repair pass on every SSE event — dies of
 * nesting depth and is indifferent to length. A census that comes back with a
 * depth in the thousands names the culprit; one that comes back with a depth in
 * the tens clears every parser in the process at once and sends the search to
 * the schema-walking code instead. Either way the next occurrence settles it,
 * rather than adding a third anecdote.
 *
 * A self-reference gets its own flag, because that is the shape that has already
 * caused this exact failure once here: jiti's interop `default` pointing back at
 * the schema it decorated, which sent TypeBox's compiler round forever (see
 * `shared/src/structuredExchangeSchemaNode.ts`). A cycle anywhere in a turn's
 * payload is the single most likely explanation and the cheapest to confirm.
 *
 * What is written is a census and not a transcript: counts, byte sizes, depths,
 * roles, block and tool names. No message text, no tool arguments, no file
 * contents. A shape is enough to find a recursion, and a forensic file that
 * accumulates conversations is not something a deployment should have to think
 * about before turning this on. The one verbatim field is a provider's own
 * `diagnostics`, which is the only object in the pipeline that ever carries a
 * stack — and which the provider wrote to be read.
 */
import fs from "node:fs";
import path from "node:path";

/** Where the census stops descending. Far past any legitimate payload. */
const DEPTH_CAP = 20_000;

/** Above this the log is rolled to `.1`, so a long-lived server cannot fill a disk. */
const MAX_LOG_BYTES = 4 * 1024 * 1024;

/** How many entries the record names individually. The rest are counted, not listed. */
const WORST_LISTED = 8;

/**
 * Recognises the failure this exists for.
 *
 * Deliberately narrow. Every other turn failure — a rate limit, a dropped
 * connection, a refusal — is already legible in the bubble and needs no forensic
 * file; widening this would bury the rare event in the common ones.
 */
export function isStackExhaustion(message: string): boolean {
  return /maximum call stack size exceeded|call stack size exceeded|stack overflow/i.test(message);
}

/**
 * The flag that arms the one thing this census cannot supply.
 *
 * Duplicated from `providerStackHook.mjs` rather than imported: that module is a
 * `--import` target loaded before any of this, it cannot read TypeScript, and importing
 * it here would run its registration a second time. Two short lists, one comment each.
 */
export const PROVIDER_STACK_ENV = "PI_OUTPOST_PROVIDER_STACK";

const PROVIDER_STACK_OFF = new Set(["", "0", "false", "no", "off"]);

/** Whether the next occurrence will carry a stack, or another census with no trace. */
export function providerStackProbeArmed(env: NodeJS.ProcessEnv = process.env): boolean {
  return !PROVIDER_STACK_OFF.has((env[PROVIDER_STACK_ENV] ?? "").trim().toLowerCase());
}

/** Said at the only moment anyone wants to hear it: a failure that arrived without one. */
export const PROVIDER_STACK_HINT =
  `[pi-outpost] no stack accompanies this — the provider's catch drops it. Set ${PROVIDER_STACK_ENV}=1` +
  " and the next occurrence will print one.";

/** What a value's shape says about why a recursive walk over it might not return. */
export interface ShapeCensus {
  /** Deepest nesting reached, counting the value itself as 1. */
  depth: number;
  /** A value reachable from itself: the shape that makes a recursive walk never end. */
  cyclic: boolean;
  /** The descent stopped at DEPTH_CAP, so `depth` is a floor rather than the answer. */
  capped: boolean;
}

/**
 * Measure nesting depth without recursing.
 *
 * The obvious implementation — a function that calls itself per level — would
 * overflow on precisely the input worth measuring, and report a crash instead of
 * a number. So the descent is an explicit stack, and the set of nodes currently
 * *on the path* (not merely seen) gives true cycle detection: a shared subobject
 * reached twice by different routes is ordinary, and must not be reported as a
 * self-reference.
 */
export function inspectShape(root: unknown): ShapeCensus {
  let depth = 0;
  let cyclic = false;
  let capped = false;
  const onPath = new Set<object>();
  const stack: { node: object; children: unknown[]; next: number }[] = [];

  const enter = (value: unknown, level: number): void => {
    if (level > depth) depth = level;
    if (value === null || typeof value !== "object") return;
    if (onPath.has(value)) {
      cyclic = true;
      return;
    }
    if (level >= DEPTH_CAP) {
      capped = true;
      return;
    }
    onPath.add(value);
    stack.push({ node: value, children: Array.isArray(value) ? value : Object.values(value), next: 0 });
  };

  enter(root, 1);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.next >= frame.children.length) {
      onPath.delete(frame.node);
      stack.pop();
      continue;
    }
    // A frame at stack position n holds a value at level n; its children are n+1.
    enter(frame.children[frame.next++], stack.length + 1);
  }
  return { depth, cyclic, capped };
}

/**
 * Serialized size, or null when the value cannot be serialized at all.
 *
 * Null is itself a finding rather than a gap: `JSON.stringify` throws on a cycle
 * and overflows on a deep enough value, which are the two conditions this file
 * is looking for.
 */
export function serializedBytes(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : Buffer.byteLength(json);
  } catch {
    return null;
  }
}

/** One conversation entry, measured. */
interface EntryCensus extends ShapeCensus {
  index: number;
  role: string;
  bytes: number | null;
}

function roleOf(entry: unknown): string {
  const record = entry as { message?: { role?: unknown }; type?: unknown } | null;
  const role = record?.message?.role;
  if (typeof role === "string") return role;
  return typeof record?.type === "string" ? record.type : "unknown";
}

function censusOfEntries(entries: readonly unknown[]): {
  count: number;
  bytes: number | null;
  deepest: EntryCensus[];
  largest: EntryCensus[];
  cyclic: EntryCensus[];
} {
  const measured: EntryCensus[] = entries.map((entry, index) => ({
    index,
    role: roleOf(entry),
    bytes: serializedBytes(entry),
    ...inspectShape(entry),
  }));
  const byDepth = [...measured].sort((a, b) => b.depth - a.depth).slice(0, WORST_LISTED);
  const byBytes = [...measured].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, WORST_LISTED);
  return {
    count: measured.length,
    bytes: measured.reduce<number | null>((total, one) => (total === null || one.bytes === null ? null : total + one.bytes), 0),
    deepest: byDepth,
    largest: byBytes,
    cyclic: measured.filter((one) => one.cyclic),
  };
}

/** The finished assistant message, reduced to what a post-mortem can use. */
function censusOfTurn(message: unknown): Record<string, unknown> {
  const record = (message ?? {}) as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  return {
    provider: record.provider,
    model: record.model,
    api: record.api,
    stopReason: record.stopReason,
    rawStopReason: record.rawStopReason,
    // Verbatim: on the providers that attach one this is the only object in the
    // whole pipeline that ever carried a stack, and it must not be summarized.
    diagnostics: record.diagnostics,
    blocks: content.map((block: unknown) => {
      const one = (block ?? {}) as Record<string, unknown>;
      return {
        type: one.type,
        ...(typeof one.name === "string" ? { toolName: one.name } : {}),
        bytes: serializedBytes(one),
        ...inspectShape(one),
      };
    }),
  };
}

/**
 * The run-up, kept because the failure is never the whole story.
 *
 * The reported sequence is three red things in a row: a `bash` or `read` card,
 * then "Request was aborted", then the overflow. Only the last one matches
 * `isStackExhaustion`, so a record of that one alone throws away the two events
 * that say what the process was doing when the stack went. This ring holds the
 * recent outcomes — tool results and failed turns — and the census carries them
 * along, so one occurrence shows the shape of the run-up instead of its last
 * frame.
 *
 * Sizes, names and flags only; no tool output and no message text.
 */
const RECENT_LIMIT = 32;
const recent: Record<string, unknown>[] = [];

function note(entry: Record<string, unknown>): void {
  recent.push({ at: new Date().toISOString(), ...entry });
  if (recent.length > RECENT_LIMIT) recent.shift();
}

/** A finished tool call: which one, whether it failed, and how much it returned. */
export function noteToolOutcome(toolName: string, isError: boolean, content: unknown): void {
  note({ kind: "tool", toolName, isError, bytes: serializedBytes(content) });
}

/**
 * A finished turn that carried an error.
 *
 * Every failed turn, not only the exhausted ones: "Request was aborted" is not
 * itself the bug and is exactly the context the bug is missing.
 */
export function noteTurnOutcome(message: unknown): void {
  const record = (message ?? {}) as Record<string, unknown>;
  if (typeof record.errorMessage !== "string") return;
  note({
    kind: "turn",
    provider: record.provider,
    model: record.model,
    stopReason: record.stopReason,
    rawStopReason: record.rawStopReason,
    errorMessage: record.errorMessage,
    usage: record.usage,
  });
}

/**
 * Compaction, which is what pi does *after* a turn fails.
 *
 * Every reported occurrence follows a cut request — an abort, a timeout — and
 * never the nominal path, so what runs between the cut and the overflow is the
 * part worth seeing. A compaction in the run-up is a model call of its own over
 * a rebuilt branch; its absence is just as informative.
 */
export function noteCompaction(phase: "start" | "end", errorMessage?: string): void {
  note({ kind: "compaction", phase, ...(errorMessage === undefined ? {} : { errorMessage }) });
}

/** Which red bubble the failure became, so a record can be matched to what was seen. */
export type TurnFailureSource = "assistant" | "compaction" | "runtime" | "runtime_failed";

export interface TurnFailureReport {
  source: TurnFailureSource;
  /** The text exactly as the browser will show it. */
  message: string;
  /** pi's finished assistant message, when the failure was a turn's own. */
  assistantMessage?: unknown;
  /** The active branch as it stood — the input the overflow is a function of. */
  entries?: readonly unknown[];
  /** Context tokens at the moment it failed, when the server has a reading. */
  contextUsage?: unknown;
}

/** Roll the log rather than let it grow without bound. */
function rollIfLarge(file: string): void {
  try {
    if (fs.statSync(file).size < MAX_LOG_BYTES) return;
    fs.renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or a rename we lost a race on. Either way, append below.
  }
}

/**
 * Write one record, synchronously and best-effort.
 *
 * Synchronous on purpose: `runtime_failed` means the runtime is finished, and an
 * async append scheduled behind it is an append that may never run. A diagnostic
 * that loses the one occurrence it exists to capture is worse than none, and this
 * only runs on a failure that is already rare.
 */
export function recordTurnFailure(agentDir: string, report: TurnFailureReport): void {
  try {
    writeRecord(agentDir, report);
  } catch (error) {
    // A diagnostic that takes down the event handler it runs in has cost more
    // than it can ever return. The census is best-effort by construction.
    console.error(`[pi-outpost] turn-failure census failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeRecord(agentDir: string, report: TurnFailureReport): void {
  const record: Record<string, unknown> = {
    at: new Date().toISOString(),
    source: report.source,
    message: report.message,
    ...(report.assistantMessage === undefined ? {} : { turn: censusOfTurn(report.assistantMessage) }),
    ...(report.entries === undefined ? {} : { context: censusOfEntries(report.entries) }),
    ...(report.contextUsage === undefined ? {} : { contextUsage: report.contextUsage }),
    // Oldest first, so the record reads in the order the user watched it happen.
    recent: [...recent],
  };

  const context = record.context as { count?: number; deepest?: EntryCensus[]; cyclic?: EntryCensus[] } | undefined;
  const headline = [
    `[pi-outpost] turn failed with stack exhaustion (${report.source})`,
    context?.count === undefined ? "" : ` context=${context.count} entries`,
    context?.deepest?.[0] === undefined ? "" : ` maxDepth=${context.deepest[0].depth}`,
    context?.cyclic?.length ? ` SELF-REFERENCE in ${context.cyclic.length} entr${context.cyclic.length === 1 ? "y" : "ies"}` : "",
  ].join("");
  console.error(headline);
  if (!providerStackProbeArmed()) console.error(PROVIDER_STACK_HINT);

  const file = path.join(agentDir, "turn-failures.jsonl");
  try {
    fs.mkdirSync(agentDir, { recursive: true });
    rollIfLarge(file);
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    console.error(`[pi-outpost] wrote a full census to ${file}`);
  } catch (error) {
    // The census is worth more than the file: if nothing can be written, put it
    // on stderr rather than lose the occurrence.
    console.error(`[pi-outpost] could not write ${file}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(JSON.stringify(record));
  }
}
