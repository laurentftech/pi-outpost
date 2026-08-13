import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathDelimiters } from "../util/markdownMath";
import { getFormattedToolOutput, parseLooseJson } from "../util/toolOutput";
import { diffLines } from "../util/diff";
import { DiffBlock, SplitDiffBlock } from "../components/DiffBlocks";
import { RenderedHtml } from "../components/RenderedHtml";
import { formatOrientSummary } from "./orientSummary";
import type { PresentationProps, ToolItem } from "./types";

/** Markdown as tool cards render it: GFM, math, KaTeX, stable plugin identity. */
export function ToolMarkdown({ text }: { text: string }) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);
  return (
    <div className="prose-chat max-h-96 overflow-auto text-zinc-700 dark:text-zinc-300">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {normalizeMathDelimiters(text)}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The tool's own output, inert. Never parsed as markup — this is the untrusted
 * channel (see design.md, decision 3).
 */
export function RawBody({ item }: { item: ToolItem }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300">
      {item.output ? item.output : item.running ? "running…" : "(no output)"}
    </pre>
  );
}

export const rawPresentation = {
  id: "raw",
  match: () => true,
  stable: false,
  Expanded: RawBody,
} as const;

/* ── Extension-rendered ─────────────────────────────────────────────────────── */

export const extensionHtmlPresentation = {
  id: "extension-html",
  match: (item: ToolItem) => Boolean(item.outputHtml),
  stable: false,
  extensionOwned: true,
  showsRawReveal: true,
  // Only the compact rendering is a preview. An extension that supplied none gets
  // the folded header alone, as before — the full body is not a summary of itself.
  hasCollapsed: (item: ToolItem) => Boolean(item.outputHtmlCollapsed),
  Collapsed: ({ item }: PresentationProps) => (
    <RenderedHtml html={item.outputHtmlCollapsed ?? ""} className="max-h-96 text-zinc-700 dark:text-zinc-300" />
  ),
  Expanded: ({ item }: PresentationProps) => (
    <RenderedHtml html={item.outputHtml ?? ""} className="max-h-96 text-zinc-700 dark:text-zinc-300" />
  ),
} as const;

/* ── File edit ──────────────────────────────────────────────────────────────── */

/** The edit tool's before/after pairs, when this call has them. */
export function editPairs(item: ToolItem): { oldText: string; newText: string }[] | null {
  if (item.toolName !== "edit" || item.args === null || typeof item.args !== "object") return null;
  const edits = (item.args as { edits?: unknown }).edits;
  if (!Array.isArray(edits)) return null;
  const pairs = edits.filter(
    (e): e is { oldText: string; newText: string } =>
      e !== null &&
      typeof e === "object" &&
      typeof (e as Record<string, unknown>).oldText === "string" &&
      typeof (e as Record<string, unknown>).newText === "string",
  );
  return pairs.length > 0 ? pairs : null;
}

export const fileEditPresentation = {
  id: "file-edit",
  match: (item: ToolItem) => editPairs(item) !== null,
  stable: true,
  startsExpanded: true,
  showsRawReveal: true,
  Expanded: ({ item }: PresentationProps) => (
    <div className="flex flex-col gap-2">
      {(editPairs(item) ?? []).map((pair, i) => (
        <SplitDiffBlock key={i} lines={diffLines(pair.oldText, pair.newText)} />
      ))}
    </div>
  ),
} as const;

/* ── File write ─────────────────────────────────────────────────────────────── */

/** The write tool's new content (rendered as an all-additions diff). */
export function writeContent(item: ToolItem): string | null {
  if (item.toolName !== "write" || item.args === null || typeof item.args !== "object") return null;
  const content = (item.args as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export const fileWritePresentation = {
  id: "file-write",
  match: (item: ToolItem) => writeContent(item) !== null,
  stable: true,
  startsExpanded: true,
  showsRawReveal: true,
  Expanded: ({ item }: PresentationProps) => (
    <DiffBlock lines={(writeContent(item) ?? "").split("\n").map((text) => ({ type: "add" as const, text }))} />
  ),
} as const;

/* ── Render envelope ────────────────────────────────────────────────────────── */

/**
 * A tool that declared its own display text. Shown folded, as it was before the
 * registry existed: the summary is the preview, the raw output is the detail.
 */
export const renderEnvelopePresentation = {
  id: "pi-render",
  match: (item: ToolItem) => (item.output ? getFormattedToolOutput(item.output) !== undefined : false),
  stable: false,
  Collapsed: ({ item }: PresentationProps) => (
    <ToolMarkdown text={getFormattedToolOutput(item.output ?? "") ?? ""} />
  ),
  Expanded: RawBody,
} as const;

/* ── Orient summary (vendor-shaped) ─────────────────────────────────────────── */

export const orientSummaryPresentation = {
  id: "orient-summary",
  match: (item: ToolItem) => (item.output ? formatOrientSummary(parseLooseJson(item.output)) !== undefined : false),
  stable: false,
  Collapsed: ({ item }: PresentationProps) => (
    <ToolMarkdown text={formatOrientSummary(parseLooseJson(item.output ?? "")) ?? ""} />
  ),
  Expanded: RawBody,
} as const;
