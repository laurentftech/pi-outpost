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
import { assertWritableDestination, excerptOf, extractionSummary, writeExtraction } from "./extractionOutput.ts";
import { extractPdf, PdfError, type PdfMode } from "./pdf.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";

export interface PdfToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones the resolved path must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Largest PDF this tool will open, in bytes. */
  maxBytes: number;
  /**
   * Zone `output_path` must land in. `null` means writing is disabled, and every
   * destination is refused — reading is unaffected.
   */
  writableRoot: string | null;
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
  full: Type.Optional(
    Type.Boolean({
      description: "Return the whole document in one call instead of the first pages. Refused if it is too large for one answer — use output_path then.",
    }),
  ),
  output_path: Type.Optional(
    Type.String({
      description: "Write the whole extraction to this workspace path and return a summary instead of the content. The file must not already exist.",
    }),
  ),
});

const DESCRIPTION = [
  "Extract the content of a PDF as markdown: text per page, and tables reconstructed as markdown tables.",
  "If the user wants the document saved, converted, or written anywhere, pass output_path: it writes the whole document there in one call and returns a short summary.",
  "Do not return the content and then write it yourself — that spends the context twice.",
  "Otherwise output is capped per call — when it is truncated it says so and names the page range to ask for next, or pass full:true to get everything at once.",
  "Table reconstruction is best-effort; use mode=\"text\" to see a page exactly as its text layer reads.",
  "A scanned PDF has no text layer and is reported as such: there is no OCR.",
].join(" ");

/** Past this, an answer is large enough that the file option is worth naming again. */
const LARGE_ANSWER_CHARS = 60_000;

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
      "When the user asks for a document to be saved or converted to a file, give the extraction tool an output_path instead of returning the content and writing it afterwards.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const {
        path: target,
        pages,
        mode,
        full,
        output_path: destination,
      } = params as { path: string; pages?: string; mode?: PdfMode; full?: boolean; output_path?: string };

      // SECURITY: scopeToRoot confines `path` and nothing else, so `output_path`
      // is checked by writeExtraction against the writable zone. Two arguments,
      // two zones — the read zone never grants a write.
      const resolved = await realResolve(path.resolve(options.cwd, target));
      if (!isWithinAny(options.allowedRoots, resolved)) {
        throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
      }

      const stat = await fs.stat(resolved).catch(() => null);
      if (stat === null || !stat.isFile()) throw new Error(`No such file: ${target}`);
      if (stat.size > options.maxBytes) {
        throw new Error(`"${target}" is larger than the ${describeSize(options.maxBytes)} PDF limit`);
      }

      // Checked before any parsing: a refusal is knowable now, and spending the
      // parse first only to refuse afterwards wastes it.
      if (destination !== undefined) {
        await assertWritableDestination(destination, { cwd: options.cwd, writableRoot: options.writableRoot });
      }

      // A destination writes the whole document: a file holding the first pages of
      // a long report looks finished, which is worse than no file at all.
      const wholeDocument = full === true || destination !== undefined;

      let extraction: Awaited<ReturnType<typeof extractPdf>>;
      try {
        extraction = await extractPdf(new Uint8Array(await fs.readFile(resolved)), {
          ...(pages === undefined ? {} : { pages }),
          ...(mode === undefined ? {} : { mode }),
          ...(wholeDocument ? { full: true } : {}),
        });
      } catch (error) {
        // The reason is the useful part: "password-protected" and "not a PDF"
        // call for different next moves, and neither is worth a retry loop.
        if (error instanceof PdfError) throw new Error(error.message);
        throw error;
      }

      if (destination === undefined) {
        // A very large answer is the moment output_path becomes worth knowing about:
        // saying so here reaches the caller when the cost is in front of it, which a
        // tool description read once at session start does not.
        const text =
          extraction.markdown.length > LARGE_ANSWER_CHARS
            ? `${extraction.markdown}\n\n> This answer is ${extraction.markdown.length} characters. ` +
              `For a document this size, pass output_path next time to write it to a file instead.`
            : extraction.markdown;
        return { content: [{ type: "text", text }], details: undefined };
      }

      const written = await writeExtraction(destination, extraction.markdown, {
        cwd: options.cwd,
        writableRoot: options.writableRoot,
      });
      const summary = extractionSummary(written, {
        covered: `${extraction.pages.length} of ${extraction.pageCount} pages`,
        excerpt: excerptOf(extraction.markdown),
      });
      return { content: [{ type: "text", text: summary }], details: undefined };
    },
  } as ToolDefinition;
}
