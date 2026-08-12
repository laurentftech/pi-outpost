import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  contentText,
  truncate,
  historyToItems,
  assistantToItem,
  customMessageToItem,
  messageUsage,
} from "../src/convert.ts";

// ---------------------------------------------------------------------------
// contentText
// ---------------------------------------------------------------------------
describe("contentText", () => {
  test("returns empty string for undefined", () => {
    assert.equal(contentText(undefined), "");
  });

  test("returns a plain string as-is", () => {
    assert.equal(contentText("hello"), "hello");
  });

  test("extracts text blocks from an array", () => {
    const arr = [
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
    ];
    assert.equal(contentText(arr), "Hello\n world");
  });

  test("skips non-text blocks (images)", () => {
    const arr = [
      { type: "text", text: "Look:" },
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "text", text: "done" },
    ];
    assert.equal(contentText(arr), "Look:\n[image]\ndone");
  });

  test("handles blocks with missing text", () => {
    const arr = [{ type: "text" }, { type: "text", text: "ok" }];
    assert.equal(contentText(arr), "ok");
  });

  test("handles empty array", () => {
    assert.equal(contentText([]), "");
  });

  test("filters empty entries", () => {
    const arr = [
      { type: "text", text: "a" },
      { type: "text", text: "" },
      { type: "text", text: "b" },
    ];
    assert.equal(contentText(arr), "a\nb");
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------
describe("truncate", () => {
  test("returns short text unchanged", () => {
    assert.equal(truncate("hello"), "hello");
  });

  test("returns text at the limit unchanged", () => {
    const text = "a".repeat(20_000);
    assert.equal(truncate(text, 20_000).length, 20_000);
  });

  test("truncates text over the limit with a message", () => {
    const result = truncate("x".repeat(25), 20);
    assert.ok(result.startsWith("x".repeat(20)));
    assert.ok(result.includes("25 chars total"));
    assert.ok(result.includes("…"));
  });

  test("uses the default max (20 000)", () => {
    const short = "ok";
    assert.equal(truncate(short), short);
  });
});

// ---------------------------------------------------------------------------
// historyToItems — the main conversion pipeline
// ---------------------------------------------------------------------------
describe("historyToItems", () => {
  test("converts a user message to a user ChatItem", () => {
    const items = historyToItems([{ role: "user", content: "hello" }]);
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "user");
    assert.equal((items[0] as Extract<typeof items[0], { kind: "user" }>).text, "hello");
  });

  test("converts user message with images", () => {
    const items = historyToItems([
      {
        role: "user",
        content: [
          { type: "text", text: "see this" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ],
      },
    ]);
    assert.equal(items.length, 1);
    const user = items[0] as Extract<(typeof items)[0], { kind: "user" }>;
    assert.equal(user.text, "see this");
    assert.deepEqual(user.images, [{ data: "abc", mimeType: "image/png" }]);
  });

  test("skips empty user content", () => {
    const items = historyToItems([{ role: "user", content: "" }]);
    assert.equal(items.length, 0);
  });

  test("converts assistant message with text and thinking blocks", () => {
    const items = historyToItems([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me think" },
          { type: "text", text: "the answer" },
        ],
      },
    ]);
    assert.equal(items.length, 1);
    const asst = items[0] as Extract<(typeof items)[0], { kind: "assistant" }>;
    assert.equal(asst.kind, "assistant");
    assert.deepEqual(asst.blocks, [
      { type: "thinking", text: "let me think", contentIndex: 0 },
      { type: "text", text: "the answer", contentIndex: 1 },
    ]);
  });

  test("converts assistant with error message", () => {
    const items = historyToItems([
      { role: "assistant", content: [{ type: "text", text: "failed" }], errorMessage: "API error" },
    ]);
    const asst = items[0] as Extract<(typeof items)[0], { kind: "assistant" }>;
    assert.equal(asst.errorMessage, "API error");
  });

  test("matches toolResult with a preceding toolCall", () => {
    const items = historyToItems([
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "f.txt" } }],
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "read",
        content: "file content",
        isError: false,
      },
    ]);
    // assistant with no text blocks → no assistant item
    // tool result with matching call → tool item
    assert.equal(items.length, 1);
    const tool = items[0] as Extract<(typeof items)[0], { kind: "tool" }>;
    assert.equal(tool.kind, "tool");
    assert.equal(tool.toolCallId, "tc1");
    assert.equal(tool.toolName, "read");
    assert.equal(tool.output, "file content");
    assert.equal(tool.isError, false);
  });

  test("toolResult without matching toolCall still produces a tool item", () => {
    const items = historyToItems([
      {
        role: "toolResult",
        toolCallId: "orphan",
        toolName: "bash",
        content: "output",
        isError: false,
      },
    ]);
    assert.equal(items.length, 1);
    const tool = items[0] as Extract<(typeof items)[0], { kind: "tool" }>;
    assert.equal(tool.toolName, "bash");
    assert.equal(tool.output, "output");
  });

  test("toolResult references tool name from pending call when no explicit toolName", () => {
    const items = historyToItems([
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc2", name: "grep", arguments: { pattern: "foo" } }],
      },
      { role: "toolResult", toolCallId: "tc2", content: "match" },
    ]);
    assert.equal(items.length, 1);
    const tool = items[0] as Extract<(typeof items)[0], { kind: "tool" }>;
    assert.equal(tool.toolName, "grep");
    assert.equal(tool.args.pattern, "foo");
  });

  test("marks trailing assistant as streaming when flag is set", () => {
    const items = historyToItems(
      [{ role: "assistant", content: [{ type: "text", text: "partial" }] }],
      true,
    );
    assert.equal(items.length, 1);
    const asst = items[0] as Extract<(typeof items)[0], { kind: "assistant" }>;
    assert.equal(asst.streaming, true);
  });

  test("creates empty streaming assistant when trailing message has no blocks", () => {
    const items = historyToItems(
      [{ role: "assistant", content: [{ type: "toolCall", id: "t", name: "bash", arguments: {} }] }],
      true,
    );
    assert.equal(items.length, 2); // empty assistant + pending tool card
    const empty = items[0] as Extract<(typeof items)[0], { kind: "assistant" }>;
    assert.equal(empty.kind, "assistant");
    assert.equal(empty.streaming, true);
    assert.deepEqual(empty.blocks, []);
  });

  test("adds running tool cards for pending toolCalls in streaming mode", () => {
    const items = historyToItems(
      [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "run1", name: "bash", arguments: { command: "ls" } }],
        },
      ],
      true,
    );
    const running = items.find((i) => i.kind === "tool") as Extract<(typeof items)[0], { kind: "tool" }>;
    assert.ok(running);
    assert.equal(running.running, true);
    assert.equal(running.toolName, "bash");
    assert.equal(running.output, "");
  });

  test("does not add running tool cards without streaming flag", () => {
    const items = historyToItems([
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "nope", name: "bash", arguments: {} }],
      },
    ]);
    assert.equal(items.filter((i) => i.kind === "tool").length, 0);
  });

  test("aligns user entry IDs right-to-left", () => {
    const items = historyToItems(
      [
        { role: "user", content: "first" },
        { role: "assistant", content: [{ type: "text", text: "reply" }] },
        { role: "user", content: "second" },
      ],
      false,
      ["eid-old", "eid-new"],
    );
    const users = items.filter((i) => i.kind === "user") as Extract<(typeof items)[0], { kind: "user" }>[];
    assert.equal(users.length, 2);
    // Right-aligned: last user gets last entryId
    assert.equal(users[0].entryId, "eid-old");
    assert.equal(users[1].entryId, "eid-new");
  });

  test("handles custom messages with display:true", () => {
    const items = historyToItems([
      {
        role: "custom",
        customType: "greeting",
        content: [{ type: "text", text: "hi from ext" }],
        display: true,
      },
    ]);
    assert.equal(items.length, 1);
    const custom = items[0] as Extract<(typeof items)[0], { kind: "custom" }>;
    assert.equal(custom.kind, "custom");
    assert.equal(custom.text, "hi from ext");
  });

  test("skips custom messages with display:false", () => {
    const items = historyToItems([
      {
        role: "custom",
        customType: "hidden",
        content: [{ type: "text", text: "invisible" }],
        display: false,
      },
    ]);
    assert.equal(items.length, 0);
  });

  test("handles empty message list", () => {
    assert.deepEqual(historyToItems([]), []);
  });

  test("streaming flag without assistant at the end does not add an item", () => {
    const items = historyToItems([{ role: "user", content: "hi" }], true);
    const asstItems = items.filter((i) => i.kind === "assistant");
    assert.equal(asstItems.length, 0);
  });

  test("assistant with error but no blocks still appears", () => {
    const items = historyToItems([
      { role: "assistant", content: [], errorMessage: "something broke" },
    ]);
    assert.equal(items.length, 1);
    const asst = items[0] as Extract<(typeof items)[0], { kind: "assistant" }>;
    assert.equal(asst.errorMessage, "something broke");
    assert.deepEqual(asst.blocks, []);
  });
});

// ---------------------------------------------------------------------------
// assistantToItem
// ---------------------------------------------------------------------------
describe("historyToItems — turn usage", () => {
  test("replayed assistant turns keep the usage they reported", () => {
    const items = historyToItems([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        usage: { input: 8, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { total: 0.002 } },
      },
    ]);
    const assistant = items.find((item) => item.kind === "assistant");
    assert.equal(assistant?.usage?.totalTokens, 12);
    assert.equal(assistant?.usage?.cost, 0.002);
  });

  test("a replayed turn that reported nothing carries no usage", () => {
    const items = historyToItems([{ role: "assistant", content: [{ type: "text", text: "hello" }] }]);
    const assistant = items.find((item) => item.kind === "assistant");
    assert.equal(assistant?.usage, undefined);
  });

  test("a turn that only called tools is still replayed for its usage", () => {
    // Nothing to show — but it is a turn, and dropping it would make a reopened
    // session report less than it did while it ran.
    const items = historyToItems([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } }],
        usage: { input: 20, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 23, cost: { total: 0.004 } },
      },
    ]);
    const assistant = items.find((item) => item.kind === "assistant");
    assert.equal(assistant?.blocks.length, 0);
    assert.equal(assistant?.usage?.totalTokens, 23);
    assert.equal(assistant?.usage?.cost, 0.004);
  });

  test("a tool-only turn without usage stays out of the transcript", () => {
    const items = historyToItems([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }] },
    ]);
    assert.equal(
      items.some((item) => item.kind === "assistant"),
      false,
    );
  });
});

describe("assistantToItem", () => {
  test("converts a final assistant message", () => {
    const item = assistantToItem({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
    assert.equal(item.kind, "assistant");
    assert.deepEqual(item.blocks, [{ type: "text", text: "done", contentIndex: 0 }]);
  });

  test("includes errorMessage when present", () => {
    const item = assistantToItem({
      role: "assistant",
      content: [{ type: "text", text: "oops" }],
      errorMessage: "fail",
    });
    assert.equal(item.errorMessage, "fail");
  });

  test("carries the turn's usage when the provider reported it", () => {
    const item = assistantToItem({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: { total: 0.004 } },
    });
    assert.equal(item.kind, "assistant");
    assert.deepEqual(item.usage, {
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 18,
      cost: 0.004,
    });
  });

  test("an unpriced turn yields usage without a cost", () => {
    // A self-hosted model reports counters and no price. The field must be
    // missing, not zero: zero would read as "this turn was free".
    const item = assistantToItem({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
    });
    assert.equal(item.usage?.totalTokens, 15);
    assert.equal("cost" in (item.usage ?? {}), false);
  });

  test("carries no usage when the message reports none", () => {
    const item = assistantToItem({ role: "assistant", content: [{ type: "text", text: "done" }] });
    assert.equal(item.usage, undefined);
  });
});

describe("messageUsage", () => {
  const counters = { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 };

  test("reads complete counters", () => {
    const usage = messageUsage({ role: "assistant", content: "", usage: { ...counters, totalTokens: 18 } });
    assert.deepEqual(usage, { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18 });
  });

  test("derives totalTokens when the provider omits it", () => {
    const usage = messageUsage({ role: "assistant", content: "", usage: { ...counters } });
    assert.equal(usage?.totalTokens, 18);
  });

  test("keeps reasoning tokens when reported", () => {
    const usage = messageUsage({ role: "assistant", content: "", usage: { ...counters, reasoning: 3 } });
    assert.equal(usage?.reasoning, 3);
  });

  test("rejects a turn missing a counter", () => {
    // Half a turn would skew every total built on it; a dropped turn is at least
    // visible in the turn count.
    const { cacheWrite: _omitted, ...partial } = counters;
    assert.equal(messageUsage({ role: "assistant", content: "", usage: partial }), undefined);
  });

  test("rejects a non-numeric counter", () => {
    assert.equal(
      messageUsage({ role: "assistant", content: "", usage: { ...counters, output: "5" } }),
      undefined,
    );
  });

  test("rejects an infinite counter", () => {
    assert.equal(
      messageUsage({ role: "assistant", content: "", usage: { ...counters, input: Number.POSITIVE_INFINITY } }),
      undefined,
    );
  });

  test("reports a turn the model priced", () => {
    const usage = messageUsage({
      role: "assistant",
      content: "",
      usage: { ...counters, cost: { input: 0.002, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
    });
    assert.equal(usage?.cost, 0.003);
  });

  test("treats an all-zero breakdown as no price at all", () => {
    // The SDK computes cost from the model's rates and always fills `total`, so a
    // model with no rates reports 0 — a self-hosted deployment, not a free bill.
    const usage = messageUsage({
      role: "assistant",
      content: "",
      usage: { ...counters, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    assert.equal(usage?.totalTokens, 18);
    assert.equal("cost" in (usage ?? {}), false);
  });

  test("keeps a price smaller than a cent", () => {
    const usage = messageUsage({
      role: "assistant",
      content: "",
      usage: { ...counters, cost: { input: 0.00004, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00004 } },
    });
    assert.equal(usage?.cost, 0.00004);
  });

  test("ignores a cost object without a numeric total", () => {
    const usage = messageUsage({
      role: "assistant",
      content: "",
      usage: { ...counters, cost: { input: 0.1 } },
    });
    assert.equal(usage?.cost, undefined);
  });

  test("returns nothing when there is no usage object", () => {
    assert.equal(messageUsage({ role: "assistant", content: "" }), undefined);
    assert.equal(messageUsage({ role: "assistant", content: "", usage: null }), undefined);
  });
});

// ---------------------------------------------------------------------------
// customMessageToItem
// ---------------------------------------------------------------------------
describe("customMessageToItem", () => {
  test("converts a custom message with text", () => {
    const item = customMessageToItem({
      role: "custom",
      customType: "my-type",
      content: [{ type: "text", text: "hello" }],
      display: true,
    });
    assert.equal(item.kind, "custom");
    assert.equal(item.customType, "my-type");
    assert.equal(item.text, "hello");
  });

  test("includes details when present", () => {
    const item = customMessageToItem({
      role: "custom",
      customType: "data",
      content: "raw",
      display: true,
      details: { key: "val" },
    });
    assert.deepEqual(item.details, { key: "val" });
  });

  test("defaults customType to 'custom'", () => {
    const item = customMessageToItem({
      role: "custom",
      content: "plain",
      display: true,
    });
    assert.equal(item.customType, "custom");
    assert.equal(item.text, "plain");
  });
});
