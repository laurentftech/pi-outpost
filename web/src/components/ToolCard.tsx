import { useState } from "react";
import type { ChatItem } from "@pi-interface/shared";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** One-line summary of tool args (command for bash, path for file tools…). */
function argsSummary(args: unknown): string {
  if (args === null || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const key = ["command", "path", "file_path", "pattern", "query"].find(
    (k) => typeof record[k] === "string",
  );
  if (key) return record[key] as string;
  const json = JSON.stringify(record);
  return json === "{}" ? "" : json;
}

export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const summary = argsSummary(item.args);

  return (
    <div
      className={`rounded-lg border text-sm ${
        item.isError
          ? "border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20"
          : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${
          item.running ? "animate-pulse bg-amber-400" : item.isError ? "bg-red-500" : "bg-emerald-500"
        }`} />
        <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{item.toolName}</span>
        {summary && (
          <span className="truncate font-mono text-xs text-zinc-500">{summary}</span>
        )}
        <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-600">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {summary === "" || (
            <pre className="mb-2 overflow-x-auto font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {JSON.stringify(item.args, null, 2)}
            </pre>
          )}
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {item.output || (item.running ? "running…" : "(no output)")}
          </pre>
        </div>
      )}
    </div>
  );
}
