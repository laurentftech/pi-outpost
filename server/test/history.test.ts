/**
 * Reading a conversation back past compaction.
 *
 * The session is a real one: a `SessionManager` in a throwaway directory, with real
 * messages and a real compaction entry appended to it. What is faked is only the agent
 * — there is no model to call here — and the two views of the branch the runtime
 * exposes delegate straight to that session manager. So the seam these tests assert is
 * the SDK's own seam, not our idea of it.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentRuntime, RuntimeEntry } from "../src/agentRuntime.ts";
import { ExtensionRenderer } from "../src/extensionRender.ts";
import { HistoryUnavailableError, historyWindow, olderItemCount, precedingItems } from "../src/history.ts";

const temporaryDirectories: string[] = [];

after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function sessionDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-outpost-history-"));
  temporaryDirectories.push(directory);
  return directory;
}

const context = { browserRoot: path.join(tmpdir(), "nowhere"), renderer: new ExtensionRenderer() };

/**
 * A runtime that owns a session file and nothing else.
 *
 * `branchEntries` and `contextEntries` are the delegations the embedded runtime makes,
 * so what the module under test sees is what it sees in production; everything a
 * conversation would need beyond the transcript throws, because nothing here should
 * reach for it.
 */
function runtimeOver(manager: SessionManager, kind = "embedded"): AgentRuntime {
  const runtime = {
    kind,
    snapshot: () => ({ sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile() }),
    entries: () => manager.getEntries() as RuntimeEntry[],
    contextEntries: () => manager.buildContextEntries() as RuntimeEntry[],
    branchEntries: () => manager.getBranch() as RuntimeEntry[],
  };
  return runtime as unknown as AgentRuntime;
}

/** The same runtime with no branch to offer — the shape an RPC child has. */
function runtimeWithoutBranch(manager: SessionManager): AgentRuntime {
  const runtime = runtimeOver(manager, "rpc") as unknown as Record<string, unknown>;
  delete runtime.branchEntries;
  return runtime as unknown as AgentRuntime;
}

function userMessage(text: string) {
  return { role: "user" as const, content: [{ type: "text" as const, text }] };
}

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    stopReason: "stop" as const,
    usage: { input: 120, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 160 },
  };
}

/**
 * A conversation of `turns` exchanges, compacted so that only the last `kept` of them
 * are left in the model's context. Returns the manager and the texts, oldest first.
 */
function compactedSession(turns: number, kept: number): { manager: SessionManager; texts: string[] } {
  const manager = SessionManager.create(process.cwd(), sessionDirectory());
  const texts: string[] = [];
  const userEntryIds: string[] = [];
  for (let i = 1; i <= turns; i++) {
    userEntryIds.push(manager.appendMessage(userMessage(`ask ${i}`) as never));
    manager.appendMessage(assistantMessage(`answer ${i}`) as never);
    texts.push(`ask ${i}`, `answer ${i}`);
  }
  manager.appendCompaction("what came before, in three lines", userEntryIds[turns - kept], 12_345);
  return { manager, texts };
}

describe("precedingItems", () => {
  test("recovers the turns compaction removed from the context", () => {
    const { manager } = compactedSession(5, 2);
    const runtime = runtimeOver(manager);

    const contextTexts = manager
      .buildContextEntries()
      .flatMap((entry) => ("message" in entry && entry.message ? [JSON.stringify(entry.message)] : []));
    assert.ok(
      !contextTexts.some((text) => text.includes("ask 1")),
      "the SDK's context no longer holds the first turn — otherwise this test proves nothing",
    );

    const items = precedingItems(runtime, context);
    const recovered = items.map((item) => (item.kind === "user" || item.kind === "assistant" ? itemText(item) : ""));
    assert.deepEqual(recovered, ["ask 1", "answer 1", "ask 2", "answer 2", "ask 3", "answer 3"]);
  });

  test("marks every recovered item read-only", () => {
    const { manager } = compactedSession(4, 1);
    const items = precedingItems(runtimeOver(manager), context);
    assert.ok(items.length > 0);
    assert.ok(
      items.every((item) => item.readOnly === true),
      "an item outside the model's context cannot be edited or forked from",
    );
  });

  test("recovers a tool call as one card, as the live conversion does", () => {
    const manager = SessionManager.create(process.cwd(), sessionDirectory());
    manager.appendMessage({
      role: "user",
      content: [
        { type: "text", text: "read it" },
        { type: "image", data: "aW1n", mimeType: "image/png" },
      ],
    } as never);
    manager.appendMessage(assistantMessage("```mermaid\ngraph TD; a-->b;\n```") as never);
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } }],
    } as never);
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "file body" }],
    } as never);
    const keep = manager.appendMessage(userMessage("thanks") as never);
    manager.appendMessage(assistantMessage("welcome") as never);
    manager.appendCompaction("summary", keep, 10);

    const items = precedingItems(runtimeOver(manager), context);
    const tools = items.filter((item) => item.kind === "tool");
    assert.equal(tools.length, 1, "the call and its result merge into one card");
    assert.equal(tools[0].kind === "tool" ? tools[0].toolName : "", "read");
    assert.equal(tools[0].kind === "tool" ? tools[0].output : "", "file body");

    // The image travelled with the prompt, and the diagram is text in a reply block:
    // both recovered exactly as the live conversion produces them, which is the point
    // of converting recovered history with that same function.
    const user = items.find((item) => item.kind === "user");
    assert.deepEqual(user?.kind === "user" ? user.images : undefined, [{ data: "aW1n", mimeType: "image/png" }]);
    const reply = items.find((item) => item.kind === "assistant" && item.blocks.some((b) => b.text.includes("graph")));
    assert.ok(reply, "the reply carrying a diagram is recovered with its fenced source intact");
  });

  test("returns nothing for a session that was never compacted", () => {
    const manager = SessionManager.create(process.cwd(), sessionDirectory());
    manager.appendMessage(userMessage("hello") as never);
    manager.appendMessage(assistantMessage("hi") as never);
    assert.deepEqual(precedingItems(runtimeOver(manager), context), []);
  });

  test("serves the prefix of the newer compaction after a second one runs", () => {
    const { manager } = compactedSession(4, 1);
    const runtime = runtimeOver(manager);
    const first = precedingItems(runtime, context).length;
    assert.ok(first > 0);

    manager.appendMessage(userMessage("ask 5") as never);
    manager.appendMessage(assistantMessage("answer 5") as never);
    const lastTurn = manager.appendMessage(userMessage("ask 6") as never);
    manager.appendMessage(assistantMessage("answer 6") as never);
    manager.appendCompaction("a second summary", lastTurn, 999);

    const after = precedingItems(runtime, context);
    assert.ok(after.length > first, "the second compaction pushed more of the conversation out of context");
    assert.ok(
      after.some((item) => item.kind === "compaction"),
      "the earlier compaction boundary is itself part of the recovered history",
    );
  });

  test("does not recompute the prefix while the compaction point is unchanged", () => {
    const { manager } = compactedSession(4, 1);
    let branchReads = 0;
    const runtime = runtimeOver(manager) as unknown as { branchEntries: () => RuntimeEntry[] };
    const delegate = runtime.branchEntries.bind(runtime);
    let contextReads = 0;
    const counted = runtimeOver(manager) as unknown as {
      branchEntries: () => RuntimeEntry[];
      contextEntries: () => RuntimeEntry[];
    };
    counted.branchEntries = () => {
      branchReads += 1;
      return delegate();
    };
    const contextDelegate = counted.contextEntries.bind(counted);
    counted.contextEntries = () => {
      contextReads += 1;
      return contextDelegate();
    };
    const runtimeAsAgent = counted as unknown as AgentRuntime;

    precedingItems(runtimeAsAgent, context);
    precedingItems(runtimeAsAgent, context);
    precedingItems(runtimeAsAgent, context);

    assert.equal(branchReads, 3, "the branch is read each time — it is how the cache key is found");
    assert.equal(contextReads, 1, "the conversion itself ran once");
  });

  test("refuses a runtime that cannot serve the branch", () => {
    const { manager } = compactedSession(3, 1);
    assert.throws(() => precedingItems(runtimeWithoutBranch(manager), context), HistoryUnavailableError);
  });
});

describe("historyWindow", () => {
  test("serves the items immediately before the ones the client holds", () => {
    const { manager } = compactedSession(6, 1);
    const runtime = runtimeOver(manager);
    const all = precedingItems(runtime, context).map(itemText);

    const first = historyWindow(runtime, context, 0, 4);
    assert.deepEqual(first.items.map(itemText), all.slice(all.length - 4));
    assert.equal(first.remaining, all.length - 4);

    const second = historyWindow(runtime, context, 4, 4);
    assert.deepEqual(second.items.map(itemText), all.slice(all.length - 8, all.length - 4));
    assert.equal(second.remaining, all.length - 8);
  });

  test("is continuous: consecutive windows rebuild the prefix exactly", () => {
    const { manager } = compactedSession(5, 1);
    const runtime = runtimeOver(manager);
    const all = precedingItems(runtime, context).map(itemText);

    const rebuilt: string[] = [];
    let have = 0;
    for (;;) {
      const window = historyWindow(runtime, context, have, 3);
      if (window.items.length === 0) break;
      rebuilt.unshift(...window.items.map(itemText));
      have += window.items.length;
      if (window.remaining === 0) break;
    }
    assert.deepEqual(rebuilt, all, "no gap, no repetition");
  });

  test("clamps a request above the bound and accounts for what it withheld", () => {
    const { manager } = compactedSession(150, 1);
    const runtime = runtimeOver(manager);
    const all = precedingItems(runtime, context);
    assert.ok(all.length > 200, "this session is long enough for the bound to bite");

    const window = historyWindow(runtime, context, 0, 10_000);
    assert.equal(window.items.length, 200);
    assert.equal(window.remaining, all.length - 200);
  });

  test("answers the beginning with nothing rather than an error", () => {
    const { manager } = compactedSession(3, 1);
    const runtime = runtimeOver(manager);
    const all = precedingItems(runtime, context);
    const window = historyWindow(runtime, context, all.length, 10);
    assert.deepEqual(window.items, []);
    assert.equal(window.remaining, 0);
  });
});

describe("olderItemCount", () => {
  test("counts what a reader can still ask for", () => {
    const { manager } = compactedSession(5, 2);
    const runtime = runtimeOver(manager);
    assert.equal(olderItemCount(runtime, context), precedingItems(runtime, context).length);
  });

  test("is absent when nothing was compacted", () => {
    const manager = SessionManager.create(process.cwd(), sessionDirectory());
    manager.appendMessage(userMessage("hello") as never);
    assert.equal(olderItemCount(runtimeOver(manager), context), undefined);
  });

  test("is absent when the runtime cannot serve the branch", () => {
    const { manager } = compactedSession(3, 1);
    assert.equal(olderItemCount(runtimeWithoutBranch(manager), context), undefined);
  });
});

/** The text an item shows, whatever its kind — enough to compare transcripts by. */
function itemText(item: { kind: string } & Record<string, unknown>): string {
  if (item.kind === "user" || item.kind === "custom") return String(item.text ?? "");
  if (item.kind === "assistant") {
    const blocks = (item.blocks ?? []) as { text?: string }[];
    return blocks.map((block) => block.text ?? "").join("");
  }
  if (item.kind === "tool") return `tool:${String(item.toolName)}`;
  if (item.kind === "compaction") return `compaction:${String(item.summary)}`;
  return item.kind;
}
