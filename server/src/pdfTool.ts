/**
 * The `pdf_extract` tool: a PDF's text and tables, as markdown, for the model.
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
import { extractPdf, PdfError, type PdfMode } from "./pdf.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";

export interface PdfToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones the resolved path must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Largest PDF this tool will open, in bytes. */
  maxBytes: number;
}

const parameters = Type.Object({
  path: Type.String({ description: "Path to the PDF file (relative to the workspace root, or absolute)" }),
  pages: Type.Optional(
    Type.String({
      description: 'Pages to read, e.g. "3", "2-8" or "2-8,12". Omit to start at page 1.',
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("text"), Type.Literal("tables"), Type.Literal("both")], {
      description: 'What to return: "text", "tables", or "both" (default).',
    }),
  ),
});

const DESCRIPTION = [
  "Extract the content of a PDF as markdown: text per page, and tables reconstructed as markdown tables.",
  "Output is capped per call — when it is truncated it says so and names the page range to ask for next.",
  "Table reconstruction is best-effort; use mode=\"text\" to see a page exactly as its text layer reads.",
  "A scanned PDF has no text layer and is reported as such: there is no OCR.",
].join(" ");

/** A limit is only actionable if it reads like one: "25 MB", not "0 MB". */
function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function createPdfExtractToolDefinition(options: PdfToolOptions): ToolDefinition {
  return {
    name: "pdf_extract",
    label: "PDF",
    description: DESCRIPTION,
    promptSnippet: "Read the text and tables of a PDF file",
    promptGuidelines: [
      "Use pdf_extract to read a .pdf file — read/grep return its binary bytes, not its content.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const { path: target, pages, mode } = params as { path: string; pages?: string; mode?: PdfMode };
      const resolved = await realResolve(path.resolve(options.cwd, target));
      if (!isWithinAny(options.allowedRoots, resolved)) {
        throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
      }

      const stat = await fs.stat(resolved).catch(() => null);
      if (stat === null || !stat.isFile()) throw new Error(`No such file: ${target}`);
      if (stat.size > options.maxBytes) {
        throw new Error(`"${target}" is larger than the ${describeSize(options.maxBytes)} PDF limit`);
      }

      let markdown: string;
      try {
        const result = await extractPdf(new Uint8Array(await fs.readFile(resolved)), {
          ...(pages === undefined ? {} : { pages }),
          ...(mode === undefined ? {} : { mode }),
        });
        markdown = result.markdown;
      } catch (error) {
        // The reason is the useful part: "password-protected" and "not a PDF"
        // call for different next moves, and neither is worth a retry loop.
        if (error instanceof PdfError) throw new Error(error.message);
        throw error;
      }

      return { content: [{ type: "text", text: markdown }], details: undefined };
    },
  } as ToolDefinition;
}
