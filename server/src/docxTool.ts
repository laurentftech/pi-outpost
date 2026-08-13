/**
 * The `docx_extract` tool: a Word document's text, headings and tables, as
 * markdown, for the model.
 *
 * SECURITY: the `path` parameter is named exactly that so `scopeToRoot` in
 * sandbox.ts confines it like every other file tool — no confinement logic is
 * reinvented here. The check below is the same primitive (realResolve +
 * isWithinAny), applied so the tool is confined on the non-sandboxed path too.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { DocxError, extractDocx, type DocxMode } from "./docx.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";

export interface DocxToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones the resolved path must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Largest document this tool will open, in bytes. */
  maxBytes: number;
}

const parameters = Type.Object({
  path: Type.String({ description: "Path to the .docx file (relative to the workspace root, or absolute)" }),
  blocks: Type.Optional(
    Type.String({
      description: 'Blocks to read, e.g. "12", "5-40" or "5-40,80". A block is one paragraph or one table. Omit to start at the first.',
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("text"), Type.Literal("tables"), Type.Literal("both")], {
      description: 'What to return: "text", "tables", or "both" (default).',
    }),
  ),
});

const DESCRIPTION = [
  "Extract a Word (.docx) document as markdown: paragraphs, headings, and tables with the rows and columns the document declares.",
  "Output is capped per call — when it is truncated it says so and names the block range to ask for next.",
  "Tracked changes are resolved to the accepted text: insertions are kept, deletions are not returned.",
  "Headers, footers, footnotes, comments, text boxes and images are not read.",
].join(" ");

/** A limit is only actionable if it reads like one: "25 MB", not "0 MB". */
function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function createDocxExtractToolDefinition(options: DocxToolOptions): ToolDefinition {
  return {
    name: "docx_extract",
    label: "Word",
    description: DESCRIPTION,
    promptSnippet: "Read the text, headings and tables of a Word document",
    promptGuidelines: [
      "Use docx_extract to read a .docx file — read/grep return its compressed bytes, not its content.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const { path: target, blocks, mode } = params as { path: string; blocks?: string; mode?: DocxMode };
      const resolved = await realResolve(path.resolve(options.cwd, target));
      if (!isWithinAny(options.allowedRoots, resolved)) {
        throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
      }

      const stat = await fs.stat(resolved).catch(() => null);
      if (stat === null || !stat.isFile()) throw new Error(`No such file: ${target}`);
      if (stat.size > options.maxBytes) {
        throw new Error(`"${target}" is larger than the ${describeSize(options.maxBytes)} Word limit`);
      }

      let markdown: string;
      try {
        const result = await extractDocx(new Uint8Array(await fs.readFile(resolved)), {
          ...(blocks === undefined ? {} : { blocks }),
          ...(mode === undefined ? {} : { mode }),
        });
        markdown = result.markdown;
      } catch (error) {
        // The reason is the useful part: "password-protected" and "not a Word
        // document" call for different next moves, and neither is worth retrying.
        if (error instanceof DocxError) throw new Error(error.message);
        throw error;
      }

      return { content: [{ type: "text", text: markdown }], details: undefined };
    },
  } as ToolDefinition;
}
