/**
 * The `xlsx_extract` tool: a spreadsheet's sheets and cells, as markdown tables,
 * for the model.
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
import { isWithinAny, realResolve } from "./sandbox.ts";
import { XlsxError, extractXlsx } from "./xlsx.ts";

export interface XlsxToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones the resolved path must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Largest workbook this tool will open, in bytes. */
  maxBytes: number;
  /**
   * Zone `output_path` must land in. `null` means writing is disabled, and every
   * destination is refused — reading is unaffected.
   */
  writableRoot: string | null;
}

const parameters = Type.Object({
  path: Type.String({ description: "Path to the .xlsx file (relative to the workspace root, or absolute)" }),
  sheet: Type.Optional(
    Type.String({ description: "One sheet by name. Omit to read every visible sheet, in workbook order." }),
  ),
  rows: Type.Optional(
    Type.String({
      description: 'Rows to read, e.g. "12", "5-40", "5-40,80" or "501-". Row numbers are the workbook\'s own. Omit to start at the first.',
    }),
  ),
  full: Type.Optional(
    Type.Boolean({
      description: "Return the whole workbook in one call instead of the first rows. Refused if it is too large for one answer — use output_path then.",
    }),
  ),
  output_path: Type.Optional(
    Type.String({
      description: "Write the whole extraction to this workspace path and return a summary instead of the content. The file must not already exist.",
    }),
  ),
});

const DESCRIPTION = [
  "Extract a spreadsheet (.xlsx) as markdown tables: one table per sheet, with the workbook's own column letters and row numbers so cells stay addressable.",
  "If the user wants the workbook saved, converted, or written anywhere, pass output_path: it writes every visible sheet there in one call and returns a short summary.",
  "Do not return the content and then write it yourself — that spends the context twice.",
  "Without sheet, every visible sheet is read in workbook order; hidden sheets and hidden columns are not read and are reported.",
  "Otherwise output is capped per call — when it is truncated it says so and names the sheet and row range to ask for next, or pass full:true to get everything at once.",
  "Values are rendered from the cell's number format: dates as YYYY-MM-DD, times as HH:MM:SS, decimals with a dot and no thousands separator, percentages with %, and a currency symbol only when the format states one.",
  "A computed cell shows the last result stored in the workbook; formulas themselves are not returned.",
  "Charts, pivot tables, images, conditional formatting, cell comments and defined names are not read.",
].join(" ");

/** Past this, an answer is large enough that the file option is worth naming again. */
const LARGE_ANSWER_CHARS = 60_000;

/** A limit is only actionable if it reads like one: "25 MB", not "0 MB". */
function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function createXlsxExtractToolDefinition(options: XlsxToolOptions): ToolDefinition {
  return {
    name: "xlsx_extract",
    label: "Spreadsheet",
    description: DESCRIPTION,
    promptSnippet: "Read the sheets and cells of a spreadsheet",
    promptGuidelines: [
      "Use xlsx_extract to read a .xlsx file — read/grep return its compressed bytes, not its content.",
      "When the user asks for a workbook to be saved or converted to a file, give the extraction tool an output_path instead of returning the content and writing it afterwards.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const {
        path: target,
        sheet,
        rows,
        full,
        output_path: destination,
      } = params as { path: string; sheet?: string; rows?: string; full?: boolean; output_path?: string };

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
        throw new Error(`"${target}" is larger than the ${describeSize(options.maxBytes)} spreadsheet limit`);
      }

      // Checked before any parsing: a refusal is knowable now, and spending the
      // parse first only to refuse afterwards wastes it.
      if (destination !== undefined) {
        await assertWritableDestination(destination, { cwd: options.cwd, writableRoot: options.writableRoot });
      }

      // A destination writes the whole workbook: a file holding the first rows of
      // a long sheet looks finished, which is worse than no file at all.
      const wholeWorkbook = full === true || destination !== undefined;

      let extraction: Awaited<ReturnType<typeof extractXlsx>>;
      try {
        extraction = await extractXlsx(new Uint8Array(await fs.readFile(resolved)), {
          ...(sheet === undefined ? {} : { sheet }),
          ...(rows === undefined ? {} : { rows }),
          ...(wholeWorkbook ? { full: true } : {}),
        });
      } catch (error) {
        // The reason is the useful part: "password-protected" and "not a
        // spreadsheet" call for different next moves, and neither is worth retrying.
        if (error instanceof XlsxError) throw new Error(error.message);
        throw error;
      }

      if (destination === undefined) {
        // A very large answer is the moment output_path becomes worth knowing about:
        // saying so here reaches the caller when the cost is in front of it, which a
        // tool description read once at session start does not.
        const text =
          extraction.markdown.length > LARGE_ANSWER_CHARS
            ? `${extraction.markdown}\n\n> This answer is ${extraction.markdown.length} characters. ` +
              `For a workbook this size, pass output_path next time to write it to a file instead.`
            : extraction.markdown;
        return { content: [{ type: "text", text }], details: undefined };
      }

      const written = await writeExtraction(destination, extraction.markdown, {
        cwd: options.cwd,
        writableRoot: options.writableRoot,
      });
      const summary = extractionSummary(written, {
        covered: `${extraction.sheets.length} of ${extraction.sheetCount} sheets, ${extraction.rowsCovered} rows`,
        excerpt: excerptOf(extraction.markdown),
      });
      return { content: [{ type: "text", text: summary }], details: undefined };
    },
  } as ToolDefinition;
}
