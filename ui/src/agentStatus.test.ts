import { describe, it, expect } from "vitest";
import type { ChatItem } from "@pi-outpost/shared";
import { agentStatus } from "./agentStatus";

const user = (text: string): ChatItem => ({ kind: "user", text });
const reply = (text: string, extra: Partial<Extract<ChatItem, { kind: "assistant" }>> = {}): ChatItem => ({
  kind: "assistant",
  blocks: [{ type: "text", text }],
  ...extra,
});
const tool = (toolName: string, running: boolean): ChatItem => ({
  kind: "tool",
  toolCallId: `${toolName}-1`,
  toolName,
  args: {},
  output: "",
  running,
});

describe("agentStatus", () => {
  it("is idle before any reply", () => {
    expect(agentStatus([], false, null)).toEqual({ kind: "idle" });
    expect(agentStatus([user("hi")], false, null)).toEqual({ kind: "idle" });
  });

  it("names the running tool while streaming", () => {
    expect(agentStatus([user("go"), reply(""), tool("bash", true)], true, null)).toEqual({ kind: "tool", tool: "bash" });
  });

  it("shows the last line of the streaming reply", () => {
    expect(agentStatus([user("go"), reply("First line\n\nSecond line\n")], true, null)).toEqual({
      kind: "replying",
      lastLine: "Second line",
    });
  });

  it("reports a failed turn with its error rather than an empty reply", () => {
    expect(agentStatus([user("go"), reply("", { errorMessage: "429 Rate limit exceeded" })], false, null)).toEqual({
      kind: "failed",
      error: "429 Rate limit exceeded",
    });
  });

  it("reports a settled reply, ignoring earlier turns", () => {
    const items = [user("a"), reply("old", { errorMessage: "boom" }), user("b"), reply("All done.")];
    expect(agentStatus(items, false, null)).toEqual({ kind: "done", lastLine: "All done." });
  });

  it("puts a pending question or grant above everything else", () => {
    expect(agentStatus([user("go"), tool("bash", true)], true, "question")).toEqual({ kind: "needsYou", what: "question" });
    expect(agentStatus([], false, "grant")).toEqual({ kind: "needsYou", what: "grant" });
  });

  it("ignores a finished tool once streaming has stopped", () => {
    expect(agentStatus([user("go"), tool("bash", false), reply("ok")], false, null)).toEqual({ kind: "done", lastLine: "ok" });
  });
});
