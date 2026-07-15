import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ChatItem } from "@pi-outpost/shared";
import { normalizeMathDelimiters } from "../markdownMath";
import { diffLines } from "../diff";
import { DiffBlock, SplitDiffBlock } from "./DiffBlocks";
import { RenderedHtml } from "./RenderedHtml";
import { getFormattedToolOutput } from "../toolOutput";

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

/** The edit tool's before/after pairs, when this call has them. */
function editPairs(item: ToolItem): { oldText: string; newText: string }[] | null {
  if (item.toolName !== "edit" || item.args === null || typeof item.args !== "object") return null;
  const edits = (item.args as { edits?: unknown }).edits;
  if (!Array.isArray(edits)) return null;
  const pairs = edits.filter(
    (e): e is { oldText: string; newText: string } =>
      e !== null && typeof e === "object" && typeof (e as Record<string, unknown>).oldText === "string" && typeof (e as Record<string, unknown>).newText === "string",
  );
  return pairs.length > 0 ? pairs : null;
}

/** The write tool's new content (rendered as an all-additions diff). */
function writeContent(item: ToolItem): string | null {
  if (item.toolName !== "write" || item.args === null || typeof item.args !== "object") return null;
  const content = (item.args as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export function ToolCard({ item }: { item: ToolItem }) {
  const hasHtml = Boolean(item.outputHtml);
  const pairs = hasHtml ? null : editPairs(item);
  const written = hasHtml ? null : writeContent(item);
  const hasDiff = pairs !== null || written !== null;
  
  // Check if tool has formatted output (either HTML from extension or __pi_render envelope)
  const formattedOutput = item.output ? getFormattedToolOutput(item.output) : undefined;
  const hasFormattedOutput = Boolean(formattedOutput);
  // Stable plugin references to prevent ReactMarkdown re-renders
  const markdownPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePluginsMemo = useMemo(() => [rehypeKatex], []);
  
  // Start collapsed to show formatted output; expanded state shows raw JSON for inspection
  // For edit/write tools with diffs, start expanded to show the diff
  // For tools with HTML from extension, start expanded to show the rendered HTML
  // For tools with formatted output, start collapsed to show the formatted MD
  const [open, setOpen] = useState(hasDiff);
  // Keep open state in sync when hasDiff changes mid-stream (e.g. tool output arrives after mount)
  useEffect(() => { setOpen(hasDiff); }, [hasDiff]);
  const summary = argsSummary(item.args);
  // In collapsed mode, show formatted MD output if available; otherwise show nothing
  const showFormattedCollapsed = !open && hasFormattedOutput;

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
          item.running ? "animate-pulse motion-reduce:animate-none bg-amber-400" : item.isError ? "bg-red-500" : "bg-emerald-500"
        }`} />
        {item.callHtml ? (
          <RenderedHtml as="span" html={item.callHtml} className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300" />
        ) : (
          <>
            <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{item.toolName}</span>
            {summary && (
              <span className="truncate font-mono text-xs text-zinc-500">{summary}</span>
            )}
          </>
        )}
        <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-600">{open ? "▾" : "▸"}</span>
      </button>
      {showFormattedCollapsed && formattedOutput && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="prose-chat max-h-96 overflow-auto text-zinc-700 dark:text-zinc-300">
            <ReactMarkdown
              remarkPlugins={markdownPlugins}
              rehypePlugins={rehypePluginsMemo}
            >
              {normalizeMathDelimiters(formattedOutput)}
            </ReactMarkdown>
          </div>
        </div>
      )}
      {open && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {pairs !== null && (
            <div className="mb-2 flex flex-col gap-2">
              {pairs.map((pair, i) => (
                <SplitDiffBlock key={i} lines={diffLines(pair.oldText, pair.newText)} />
              ))}
            </div>
          )}
          {written !== null && (
            <div className="mb-2">
              <DiffBlock lines={written.split("\n").map((text) => ({ type: "add" as const, text }))} />
            </div>
          )}
          
          {item.outputHtml ? (
            <RenderedHtml html={item.outputHtml} className="max-h-96 text-zinc-700 dark:text-zinc-300" />
          ) : item.output ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300">
              {item.output}
            </pre>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300">
              {item.running ? "running…" : "(no output)"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
