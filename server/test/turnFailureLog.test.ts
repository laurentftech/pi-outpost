/**
 * The census a stack-exhausted turn leaves behind.
 *
 * The point of these is the first test: the probe must survive an input deep
 * enough to kill a recursive one, because that is the only input anybody will
 * ever run it on. A depth measurement that overflows while measuring depth
 * reports a crash instead of the number the investigation needs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  inspectShape,
  isStackExhaustion,
  noteCompaction,
  noteToolOutcome,
  noteTurnOutcome,
  PROVIDER_STACK_ENV,
  PROVIDER_STACK_HINT,
  providerStackProbeArmed,
  recordTurnFailure,
  serializedBytes,
} from "../src/turnFailureLog.ts";

/** Nested `{ next: { next: … } }`, built iteratively so the fixture is not the bug. */
function deepChain(levels: number): unknown {
  let node: Record<string, unknown> = {};
  for (let i = 0; i < levels; i++) node = { next: node };
  return node;
}

describe("isStackExhaustion", () => {
  it("recognises what the provider actually puts in the bubble", () => {
    // Verbatim V8, which is what survives `error.message` in every provider catch.
    assert.equal(isStackExhaustion("Maximum call stack size exceeded"), true);
    assert.equal(isStackExhaustion("Auto-compaction failed: Maximum call stack size exceeded"), true);
    assert.equal(isStackExhaustion("RangeError: Maximum call stack size exceeded"), true);
  });

  it("stays narrow, so the common failures do not bury the rare one", () => {
    for (const message of [
      "429 rate limit reached; retry in 20s",
      "Connection lost",
      "The provider refused the request: context length exceeded",
      "Anthropic stream ended without a stop reason",
    ]) {
      assert.equal(isStackExhaustion(message), false, message);
    }
  });
});

describe("inspectShape", () => {
  it("measures a depth that would overflow a recursive probe", () => {
    // 60k levels: comfortably past the ~11k frames V8 gives a simple recursion,
    // so a recursive implementation of this function fails here and this one
    // must not.
    const census = inspectShape(deepChain(60_000));
    assert.equal(census.capped, true);
    assert.ok(census.depth >= 20_000, `expected the cap to be reached, got ${census.depth}`);
    assert.equal(census.cyclic, false);
  });

  it("reports the depth of an ordinary payload exactly", () => {
    // { a: [ { b: 1 } ] } — value 1, array 2, object 3, number 4.
    assert.deepEqual(inspectShape({ a: [{ b: 1 }] }), { depth: 4, cyclic: false, capped: false });
    assert.deepEqual(inspectShape("text"), { depth: 1, cyclic: false, capped: false });
    assert.deepEqual(inspectShape(null), { depth: 1, cyclic: false, capped: false });
  });

  it("flags a self-reference, the shape that has already caused this failure here", () => {
    // jiti's interop `default`, which pointed a schema at itself and sent
    // TypeBox's compiler round forever. See structuredExchangeSchemaNode.ts.
    const decorated: Record<string, unknown> = { $id: "urn:test", type: "object" };
    decorated.default = decorated;
    const census = inspectShape(decorated);
    assert.equal(census.cyclic, true);
    assert.equal(census.capped, false);
  });

  it("does not mistake a shared subobject for a cycle", () => {
    // Reached twice by different routes is ordinary; reachable from itself is not.
    const shared = { value: 1 };
    const census = inspectShape({ left: shared, right: shared });
    assert.equal(census.cyclic, false);
    assert.equal(census.depth, 3);
  });
});

describe("serializedBytes", () => {
  it("measures what a payload weighs", () => {
    assert.equal(serializedBytes({ a: 1 }), Buffer.byteLength(JSON.stringify({ a: 1 })));
  });

  it("returns null rather than throwing on the two shapes under investigation", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.equal(serializedBytes(cyclic), null);
    assert.equal(serializedBytes(deepChain(200_000)), null);
  });

  it("returns null for what JSON cannot write at all", () => {
    assert.equal(serializedBytes(undefined), null);
    assert.equal(serializedBytes(() => {}), null);
  });
});

describe("recordTurnFailure", () => {
  const withAgentDir = (run: (dir: string) => void): void => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-failure-"));
    try {
      run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const readRecords = (dir: string): Record<string, unknown>[] =>
    fs
      .readFileSync(path.join(dir, "turn-failures.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));

  it("writes the message verbatim and names the deepest entry in the context", () => {
    withAgentDir((dir) => {
      recordTurnFailure(dir, {
        source: "assistant",
        message: "Maximum call stack size exceeded",
        assistantMessage: { provider: "anthropic", model: "claude-sonnet-5", stopReason: "error", content: [] },
        entries: [
          { id: "a", message: { role: "user", content: "hi" } },
          { id: "b", message: { role: "toolResult", content: deepChain(40) } },
        ],
      });

      const [record] = readRecords(dir);
      assert.equal(record.message, "Maximum call stack size exceeded");
      assert.equal(record.source, "assistant");
      assert.equal((record.turn as Record<string, unknown>).provider, "anthropic");
      const context = record.context as { count: number; deepest: { index: number; role: string; depth: number }[] };
      assert.equal(context.count, 2);
      // The deep one must be the one the record puts first, by index and by role.
      assert.equal(context.deepest[0].index, 1);
      assert.equal(context.deepest[0].role, "toolResult");
      assert.ok(context.deepest[0].depth > 40);
    });
  });

  it("keeps a provider's diagnostics verbatim — the only place a stack ever survives", () => {
    withAgentDir((dir) => {
      const diagnostics = [{ type: "stream_error", error: { name: "RangeError", stack: "RangeError: Maximum call stack size exceeded\n    at parse" } }];
      recordTurnFailure(dir, {
        source: "assistant",
        message: "Maximum call stack size exceeded",
        assistantMessage: { provider: "pi", diagnostics, content: [] },
      });
      const [record] = readRecords(dir);
      assert.deepEqual((record.turn as Record<string, unknown>).diagnostics, diagnostics);
    });
  });

  it("records a self-referential context without hanging or throwing", () => {
    withAgentDir((dir) => {
      const entry: Record<string, unknown> = { id: "a", message: { role: "user" } };
      entry.self = entry;
      recordTurnFailure(dir, { source: "runtime", message: "Maximum call stack size exceeded", entries: [entry] });
      const [record] = readRecords(dir);
      const context = record.context as { bytes: number | null; cyclic: { index: number }[] };
      assert.equal(context.cyclic.length, 1);
      assert.equal(context.cyclic[0].index, 0);
      // Unserializable is a finding, not a gap: it is what a cycle does to JSON.
      assert.equal(context.bytes, null);
    });
  });

  it("carries the run-up, which is where every reported occurrence actually starts", () => {
    // The reported sequence, in order: a red tool card, a cut request, then the
    // overflow. Only the last one matches isStackExhaustion, so a record of that
    // one alone would throw away the two events that say what was going on.
    withAgentDir((dir) => {
      noteToolOutcome("bash", true, "command not found");
      noteTurnOutcome({ provider: "openai-completions", model: "qwen3", stopReason: "aborted", errorMessage: "Request was aborted" });
      recordTurnFailure(dir, { source: "assistant", message: "Maximum call stack size exceeded" });

      const [record] = readRecords(dir);
      const recent = record.recent as Record<string, unknown>[];
      const tail = recent.slice(-2);
      assert.deepEqual(
        tail.map((one) => one.kind),
        ["tool", "turn"],
      );
      assert.equal(tail[0].toolName, "bash");
      assert.equal(tail[0].isError, true);
      assert.equal(tail[1].errorMessage, "Request was aborted");
      assert.equal(tail[1].provider, "openai-completions");
    });
  });

  it("records a compaction in the run-up, since that is what runs after a turn fails", () => {
    withAgentDir((dir) => {
      noteCompaction("start");
      noteCompaction("end", "Auto-compaction failed: upstream timed out");
      recordTurnFailure(dir, { source: "assistant", message: "Maximum call stack size exceeded" });

      const recent = (readRecords(dir)[0].recent as Record<string, unknown>[]).slice(-2);
      assert.deepEqual(
        recent.map((one) => [one.kind, one.phase]),
        [
          ["compaction", "start"],
          ["compaction", "end"],
        ],
      );
      assert.equal(recent[1].errorMessage, "Auto-compaction failed: upstream timed out");
    });
  });

  it("ignores a turn that carried no error, so the run-up stays signal", () => {
    withAgentDir((dir) => {
      noteToolOutcome("read", false, "file contents");
      noteTurnOutcome({ provider: "openai-completions", stopReason: "stop" });
      recordTurnFailure(dir, { source: "assistant", message: "Maximum call stack size exceeded" });

      const recent = readRecords(dir)[0].recent as Record<string, unknown>[];
      assert.equal(recent[recent.length - 1].kind, "tool");
    });
  });

  it("appends, so repeated occurrences can be compared against each other", () => {
    withAgentDir((dir) => {
      for (const source of ["assistant", "compaction"] as const) {
        recordTurnFailure(dir, { source, message: "Maximum call stack size exceeded" });
      }
      const records = readRecords(dir);
      assert.equal(records.length, 2);
      assert.deepEqual(records.map((one) => one.source), ["assistant", "compaction"]);
    });
  });
});

describe("providerStackProbeArmed", () => {
  it("is off unless the variable says otherwise, whatever its case or spacing", () => {
    assert.equal(providerStackProbeArmed({}), false);
    for (const off of ["", "0", "false", " No ", "OFF"]) assert.equal(providerStackProbeArmed({ [PROVIDER_STACK_ENV]: off }), false, off);
    for (const on of ["1", "true", "yes"]) assert.equal(providerStackProbeArmed({ [PROVIDER_STACK_ENV]: on }), true, on);
  });
});

describe("recordTurnFailure: what it measures and says", () => {
  /** What the census wrote to stderr while `run` ran, and the records in the agent directory. */
  const captured = (run: (dir: string) => void): { said: string[]; records: Record<string, unknown>[]; dir: string } => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-failure-said-"));
    const said: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => said.push(args.map(String).join(" "));
    try {
      run(dir);
    } finally {
      console.error = original;
    }
    const file = path.join(dir, "turn-failures.jsonl");
    const records = fs.existsSync(file)
      ? fs
          .readFileSync(file, "utf8")
          .split(/\r?\n/)
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];
    return { said, records, dir };
  };
  const cleanup = (dir: string) => fs.rmSync(dir, { recursive: true, force: true });

  it("names each entry by its message's role, else its type, else unknown; and the heaviest, unserializable ones last", () => {
    const cyclic: Record<string, unknown> = { type: "custom" };
    cyclic.self = cyclic;
    const { records, dir } = captured((dir) =>
      recordTurnFailure(dir, {
        source: "runtime",
        message: "Maximum call stack size exceeded",
        entries: [{ message: { role: "user", content: "x".repeat(10) } }, { type: "compaction", summary: "y".repeat(100) }, null, cyclic],
        contextUsage: { tokens: 1200 },
      }),
    );
    cleanup(dir);
    const context = records[0]!.context as { largest: { index: number; role: string; bytes: number | null }[] };
    assert.deepEqual(
      context.largest.map((one) => [one.index, one.role]),
      [
        [1, "compaction"],
        [0, "user"],
        [2, "unknown"],
        [3, "custom"],
      ],
    );
    assert.equal(context.largest[3]!.bytes, null);
    assert.deepEqual(records[0]!.contextUsage, { tokens: 1200 });
  });

  it("reduces the turn to its blocks' types, tool names and sizes, whatever the message holds", () => {
    const { records, dir } = captured((dir) => {
      recordTurnFailure(dir, {
        source: "assistant",
        message: "Maximum call stack size exceeded",
        assistantMessage: { content: [{ type: "text", text: "hello" }, { type: "toolCall", name: "bash", arguments: { command: "ls" } }, null] },
      });
      recordTurnFailure(dir, { source: "assistant", message: "Maximum call stack size exceeded", assistantMessage: null });
      recordTurnFailure(dir, { source: "assistant", message: "Maximum call stack size exceeded", assistantMessage: { content: "not blocks" } });
    });
    cleanup(dir);
    const blocks = (records[0]!.turn as { blocks: Record<string, unknown>[] }).blocks;
    assert.deepEqual(
      blocks.map((block) => [block.type, block.toolName]),
      [
        ["text", undefined],
        ["toolCall", "bash"],
        [undefined, undefined],
      ],
    );
    assert.ok(!("text" in blocks[0]!), "no message text is kept");
    assert.deepEqual((records[1]!.turn as { blocks: unknown[] }).blocks, []);
    assert.deepEqual((records[2]!.turn as { blocks: unknown[] }).blocks, []);
  });

  it("keeps only the most recent outcomes, oldest first", () => {
    const { records, dir } = captured((dir) => {
      noteTurnOutcome(null);
      for (let i = 0; i < 40; i++) noteToolOutcome(`tool-${i}`, false, i);
      recordTurnFailure(dir, { source: "assistant", message: "Maximum call stack size exceeded" });
    });
    cleanup(dir);
    const recent = records[0]!.recent as { toolName: string }[];
    assert.equal(recent.length, 32);
    assert.equal(recent[0]!.toolName, "tool-8");
    assert.equal(recent.at(-1)!.toolName, "tool-39");
  });

  it("the headline counts the self-references, and the hint is given only while no stack is coming", () => {
    const cycle = () => {
      const one: Record<string, unknown> = {};
      one.self = one;
      return one;
    };
    const previous = process.env[PROVIDER_STACK_ENV];
    try {
      delete process.env[PROVIDER_STACK_ENV];
      const unarmed = captured((dir) => recordTurnFailure(dir, { source: "compaction", message: "Maximum call stack size exceeded", entries: [cycle()] }));
      cleanup(unarmed.dir);
      assert.match(unarmed.said[0]!, /^\[pi-outpost\] turn failed with stack exhaustion \(compaction\) context=1 entries maxDepth=\d+ SELF-REFERENCE in 1 entry$/);
      assert.ok(unarmed.said.includes(PROVIDER_STACK_HINT));

      process.env[PROVIDER_STACK_ENV] = "1";
      const armed = captured((dir) => recordTurnFailure(dir, { source: "runtime", message: "Maximum call stack size exceeded", entries: [cycle(), {}, cycle()] }));
      cleanup(armed.dir);
      assert.match(armed.said[0]!, / SELF-REFERENCE in 2 entries$/);
      assert.ok(!armed.said.includes(PROVIDER_STACK_HINT));

      const bare = captured((dir) => recordTurnFailure(dir, { source: "runtime_failed", message: "Maximum call stack size exceeded" }));
      cleanup(bare.dir);
      assert.equal(bare.said[0], "[pi-outpost] turn failed with stack exhaustion (runtime_failed)");
    } finally {
      if (previous === undefined) delete process.env[PROVIDER_STACK_ENV];
      else process.env[PROVIDER_STACK_ENV] = previous;
    }
  });

  it("a log grown past its limit is rolled aside, and the new record starts a fresh one", () => {
    const { records, dir } = captured((dir) => {
      fs.writeFileSync(path.join(dir, "turn-failures.jsonl"), `${"x".repeat(4 * 1024 * 1024)}\n`);
      recordTurnFailure(dir, { source: "assistant", message: "Maximum call stack size exceeded" });
    });
    try {
      assert.equal(records.length, 1, "the new file holds the new record alone");
      assert.equal(fs.statSync(path.join(dir, "turn-failures.jsonl.1")).size, 4 * 1024 * 1024 + 1);
    } finally {
      cleanup(dir);
    }
  });

  it("a census that cannot be written goes to stderr instead of being lost", () => {
    const { said, dir } = captured((dir) => {
      // A file where the agent directory should be: nothing can be created inside it.
      const blocked = path.join(dir, "not-a-directory");
      fs.writeFileSync(blocked, "");
      recordTurnFailure(blocked, { source: "assistant", message: "Maximum call stack size exceeded" });
    });
    cleanup(dir);
    assert.ok(said.some((line) => line.startsWith("[pi-outpost] could not write ")), said.join("\n"));
    const dumped = said.map((line) => (line.startsWith("{") ? (JSON.parse(line) as Record<string, unknown>) : undefined)).find(Boolean);
    assert.equal(dumped?.message, "Maximum call stack size exceeded");
  });

  it("a census that cannot even be serialized fails quietly, without throwing into its caller", () => {
    const { said, records, dir } = captured((dir) => {
      assert.doesNotThrow(() => recordTurnFailure(dir, { source: "assistant", message: "Maximum call stack size exceeded", contextUsage: { tokens: 1n } }));
    });
    cleanup(dir);
    assert.deepEqual(records, []);
    assert.ok(said.some((line) => /^\[pi-outpost\] turn-failure census failed: .*BigInt/.test(line)), said.join("\n"));
  });
});
