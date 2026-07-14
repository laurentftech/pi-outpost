import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ChatItem } from "@pi-outpost/shared";
import { normalizeMathDelimiters } from "../markdownMath";
import { diffLines } from "../diff";
import { DiffBlock, SplitDiffBlock } from "./DiffBlocks";
import { RenderedHtml } from "./RenderedHtml";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** Extract formatted user-facing text from tool output.
 * Checks for authoritative __pi_render envelope first, otherwise returns undefined.
 * For openlore tools, also formats known fields as readable markdown.
 * Handles truncated JSON by stripping the truncation suffix before parsing.
 * Falls back to simple text display if JSON parsing fails.
 */
function getFormattedToolOutput(output: string): string | undefined {
  // Try to parse as JSON - handle truncated output by stripping the truncation suffix
  let jsonToParse = output;
  const truncationMarker = "\n… [truncated,";
  if (output.includes(truncationMarker)) {
    jsonToParse = output.split(truncationMarker)[0];
  }
  
  try {
    const parsed = JSON.parse(jsonToParse);
    if (parsed && typeof parsed === "object") {
      // Check for authoritative __pi_render envelope first
      if (parsed.__pi_render?.text) {
        return String(parsed.__pi_render.text);
      }
      
      // For openlore-style JSON without __pi_render, format known fields
      const lines: string[] = [];
      if (parsed.task) lines.push(`**${String(parsed.task)}**`);
      if (parsed.searchMode) lines.push(`Mode: ${String(parsed.searchMode)}`);
      if (parsed.title) lines.push(`**${String(parsed.title)}**`);
      if (parsed.summary) lines.push(String(parsed.summary));
      if (Array.isArray(parsed.relevantFiles) && parsed.relevantFiles.length > 0) {
        lines.push("\nRelevant files:");
        for (const f of (parsed.relevantFiles as string[]).slice(0, 5)) lines.push(`- ${f}`);
      }
      if (Array.isArray(parsed.relevantFunctions) && parsed.relevantFunctions.length > 0) {
        lines.push("\nRelevant functions:");
        for (const fn of (parsed.relevantFunctions as any[]).slice(0, 5)) {
          if (fn && fn.name) lines.push(`- ${fn.name} (${fn.filePath ?? fn.file ?? "unknown"})`);
          else lines.push(`- ${String(fn)}`);
        }
      }
      if (Array.isArray(parsed.nextSteps) && parsed.nextSteps.length > 0) {
        lines.push("\nNext steps:");
        for (const s of (parsed.nextSteps as string[]).slice(0, 5)) lines.push(`- ${s}`);
      }
      if (Array.isArray(parsed.nextStepsText) && parsed.nextStepsText.length > 0) {
        lines.push("\nNext steps:");
        for (const s of (parsed.nextStepsText as string[]).slice(0, 5)) lines.push(`- ${s}`);
      }
      const summary = lines.join("\n").trim();
      if (summary) return summary;
    }
    // If parsed is a string, return it as-is (could be already formatted markdown)
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // Not JSON or parse error
  }
  
  return undefined;
}

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
  const formattedOutput = hasHtml ? undefined : (item.output ? getFormattedToolOutput(item.output) : undefined);
  const hasFormattedOutput = Boolean(formattedOutput);
  
  // Start collapsed to show formatted output; expanded state shows raw JSON for inspection
  // For edit/write tools with diffs, start expanded to show the diff
  // For tools with HTML from extension, start expanded to show the rendered HTML
  // For tools with formatted output, start collapsed to show the formatted MD
  const [open, setOpen] = useState(hasDiff || hasHtml || !hasFormattedOutput);
  
  // A live tool card starts before its extension renderer has produced HTML.
  // Reveal the result as soon as it arrives, matching the TUI's completed view.
  useEffect(() => {
    if (hasHtml) setOpen(true);
  }, [hasHtml]);
  
  const summary = argsSummary(item.args);
  const previewHtml = item.outputHtmlCollapsed ?? item.outputHtml;
  const showCollapsedPreview = !open && Boolean(previewHtml);

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
      {showCollapsedPreview && previewHtml && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <RenderedHtml html={previewHtml} className="max-h-24 text-zinc-700 dark:text-zinc-300" />
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
      {!open && formattedOutput && !showCollapsedPreview && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="prose-chat max-h-96 overflow-auto text-zinc-700 dark:text-zinc-300">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {normalizeMathDelimiters(formattedOutput)}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
