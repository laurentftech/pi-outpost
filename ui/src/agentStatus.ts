import type { ChatItem } from "@pi-outpost/shared";

/**
 * What the agent is doing, reduced to what someone writing in the file viewer
 * needs from a glance at its status strip.
 */
export type AgentStatus =
  | { kind: "idle" }
  | { kind: "replying"; lastLine: string }
  | { kind: "tool"; tool: string }
  | { kind: "failed"; error: string }
  | { kind: "done"; lastLine: string }
  | { kind: "needsYou"; what: "question" | "grant" };

function lastLine(text: string): string {
  const lines = text.trim().split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.at(-1)?.trim() ?? "";
}

/**
 * Status of the latest turn: a pending question or grant wins, then a running
 * tool, then the streaming reply; once settled, the last reply or its error.
 */
export function agentStatus(
  items: readonly ChatItem[],
  isStreaming: boolean,
  pending: "question" | "grant" | null,
): AgentStatus {
  if (pending) return { kind: "needsYou", what: pending };
  let reply = "";
  let error: string | null = null;
  let runningTool: string | null = null;
  let sawReply = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "user") break;
    if (item.kind === "tool" && item.running && runningTool === null) runningTool = item.toolName;
    if (item.kind === "assistant" && !sawReply) {
      sawReply = true;
      reply = item.blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
      error = item.errorMessage ?? null;
    }
  }
  if (isStreaming) {
    if (runningTool) return { kind: "tool", tool: runningTool };
    return { kind: "replying", lastLine: lastLine(reply) };
  }
  if (error) return { kind: "failed", error };
  if (sawReply) return { kind: "done", lastLine: lastLine(reply) };
  return { kind: "idle" };
}
