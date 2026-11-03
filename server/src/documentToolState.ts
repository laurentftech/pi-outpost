import type { RuntimeEntry } from "./agentRuntime.ts";
import { DEFERRED_TOOLS, documentToolsFor } from "./documentTools.ts";

export const DOCUMENT_TOOL_IDLE_LIMIT = { unused: 1, used: 5 };

/** Replay only the selected branch, including entries before compaction. No filesystem scan. */
export function restoredDocumentTools(entries: readonly RuntimeEntry[]) {
  const idle = new Map<string, number>();
  const everUsed = new Set<string>();
  const used = new Set<string>();
  let pending = false;
  function endTurn() {
    if (!pending) return;
    for (const [name, count] of idle) {
      if (used.has(name)) continue;
      if (
        count + 1 >=
        (everUsed.has(name)
          ? DOCUMENT_TOOL_IDLE_LIMIT.used
          : DOCUMENT_TOOL_IDLE_LIMIT.unused)
      )
        idle.delete(name);
      else idle.set(name, count + 1);
    }
    used.clear();
    pending = false;
  }
  for (const entry of entries) {
    const message = entry.message as
      { role?: string; content?: unknown; stopReason?: string } | undefined;
    if (entry.type !== "message" || !message) continue;
    if (message.role === "user") {
      endTurn();
      pending = true;
      const text =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .filter((block) => block?.type === "text")
                .map((block) => block.text ?? "")
                .join("\n")
            : "";
      for (const name of documentToolsFor(text)) idle.set(name, 0);
    }
    if (message.role !== "assistant") continue;
    pending = true;
    if (Array.isArray(message.content))
      for (const block of message.content) {
        if (block?.type !== "toolCall" || !DEFERRED_TOOLS.includes(block.name))
          continue;
        idle.set(block.name, 0);
        everUsed.add(block.name);
        used.add(block.name);
      }
    if (message.stopReason && message.stopReason !== "toolUse") endTurn();
  }
  endTurn();
  // A mere mention is not evidence of an enduring tool loadout.
  for (const name of idle.keys()) if (!everUsed.has(name)) idle.delete(name);
  return { idle, everUsed };
}
