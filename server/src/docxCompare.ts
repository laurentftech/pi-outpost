/**
 * What changed between two versions of a Word document that carry no tracked changes.
 *
 * Asking a model to compare two long extractions is not reliable: weak models miss
 * differences and invent others. Microsoft Word compares documents well — it aligns
 * paragraphs and tables, detects moves, keeps comments — and its result is a document
 * with tracked changes, which the review reading already knows how to read. So this
 * module has no comparison logic of its own: one fixed script, one Word call, one
 * reading.
 *
 * Windows only, through COM automation from PowerShell, with the same guarantees as
 * `docx_render`: no command line from the model (paths travel in environment
 * variables), private copies in a temporary directory, and the user's Word session
 * left alone.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { DocxError, extractDocx } from "./docx.ts";
import { assertWritableDestination } from "./extractionOutput.ts";
import {
  defaultEnvironment,
  describeFailure,
  powershellArgs,
  powershellPath,
  startWordLines,
  stopStartedWord,
  WORD_STARTED_LINE,
  type ProcessResult,
  type RenderEnvironment,
  type RenderSettings,
} from "./presentationRender.ts";
import { readSource } from "./presentationTools.ts";

/**
 * The author Word puts on every revision of its result. It is read where an agent
 * would otherwise read a person's name, so it says what it is.
 */
export const COMPARISON_AUTHOR = "Word comparison";

/** How to do it without this tool: named wherever the tool cannot run. */
export const MANUAL_COMPARISON =
  "To compare by hand, open the revised document in Word, choose Review → Compare → Compare…, save the result, " +
  "and read it with docx_extract and review: true.";

/**
 * Word's comparison, as PowerShell. Confirmed on Word 16.0 by
 * `scripts/probes/word-compare.ps1`.
 *
 * - `Documents.Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, …,
 *   Format, Encoding, Visible)`: no conversion dialog, read-only, not added to the
 *   recent files, `wdOpenFormatAuto` (0), invisible — as `docx_render` opens a copy.
 * - `CompareDocuments(OriginalDocument, RevisedDocument, Destination, Granularity,
 *   CompareFormatting, CompareCaseChanges, CompareWhitespace, CompareTables,
 *   CompareHeaders, CompareFootnotes, CompareTextboxes, CompareFields,
 *   CompareComments, CompareMoves, RevisedAuthor, IgnoreAllComparisonWarnings)`:
 *   into a new document (`wdCompareDestinationNew`, 2), word by word
 *   (`wdGranularityWordLevel`, 1), formatting ignored, everything else compared,
 *   moves included, revisions authored as `PI_OUTPOST_COMPARE_AUTHOR`, and no
 *   warning dialog.
 * - `SaveAs2(path, wdFormatDocumentDefault)` (16): a `.docx`.
 * - `New-Object` starts a Word of its own even while the user has one open, and it is
 *   told to quit only when no document is left in it — so a user's documents are never
 *   closed. `Quit([ref]0)`: its arguments are ByRef (see `WORD_SCRIPT`).
 * - A failure writes the exception's message alone, in UTF-8. Left to PowerShell, the
 *   error record came back wrapped at the console's width and cut mid-sentence, in the
 *   OEM code page ("r�cup�ration"). `exit` in a `catch` still runs the `finally`.
 * - The Word it starts is named on stdout, and ended by `compareWithWord` when the
 *   script is killed on a timeout (`startWordLines`, `stopStartedWord`).
 */
export const COMPARE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  "$app = $null; $original = $null; $revised = $null; $result = $null",
  "try {",
  ...startWordLines(),
  "  $missing = [Type]::Missing",
  "  $original = $app.Documents.Open($env:PI_OUTPOST_COMPARE_ORIGINAL, $false, $true, $false, $missing, $missing, $missing, $missing, $missing, 0, $missing, $false)",
  "  $revised = $app.Documents.Open($env:PI_OUTPOST_COMPARE_REVISED, $false, $true, $false, $missing, $missing, $missing, $missing, $missing, 0, $missing, $false)",
  "  $result = $app.CompareDocuments($original, $revised, 2, 1, $false, $true, $true, $true, $true, $true, $true, $true, $true, $true, $env:PI_OUTPOST_COMPARE_AUTHOR, $true)",
  "  $result.SaveAs2($env:PI_OUTPOST_COMPARE_OUTPUT, 16)",
  "} catch {",
  "  [Console]::Error.WriteLine($_.Exception.Message); exit 1",
  "} finally {",
  "  foreach ($doc in @($result, $revised, $original)) { if ($doc -ne $null) { try { $doc.Close(0) } catch { } } }",
  "  if ($app -ne $null -and $app.Documents.Count -eq 0) { $app.Quit([ref]0) }",
  "}",
].join("\n");

/**
 * Word's compared document, as bytes.
 *
 * Both files are copied into a private temporary directory first: Word works on the
 * copies, writes its result there, and the directory is removed afterwards, so nothing
 * is ever written beside the user's files.
 */
export async function compareWithWord(
  original: Uint8Array,
  revised: Uint8Array,
  settings: Pick<RenderSettings, "timeoutMs">,
  environment: RenderEnvironment,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (environment.platform !== "win32") {
    throw new Error(`Microsoft Word is unavailable: Word automation is only available on Windows. ${MANUAL_COMPARISON}`);
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-compare-"));
  try {
    const files = {
      original: path.join(workDir, "original.docx"),
      revised: path.join(workDir, "revised.docx"),
      output: path.join(workDir, "compared.docx"),
    };
    await fs.writeFile(files.original, original);
    await fs.writeFile(files.revised, revised);
    if (signal?.aborted) throw new Error("The comparison was stopped.");
    const result = await environment.run(powershellPath(environment), powershellArgs(COMPARE_SCRIPT), {
      env: {
        ...environment.env,
        PI_OUTPOST_COMPARE_ORIGINAL: files.original,
        PI_OUTPOST_COMPARE_REVISED: files.revised,
        PI_OUTPOST_COMPARE_OUTPUT: files.output,
        PI_OUTPOST_COMPARE_AUTHOR: COMPARISON_AUTHOR,
      },
      timeoutMs: settings.timeoutMs,
      signal,
      holdKillUntil: WORD_STARTED_LINE,
    });
    stopStartedWord(result, environment, signal);
    if (signal?.aborted) throw new Error("The comparison was stopped.");
    const bytes = result.code === 0 ? await fs.readFile(files.output).catch(() => null) : null;
    if (bytes !== null && bytes.length > 0) return bytes;
    if (result.timedOut) {
      throw new Error(
        `Word did not finish the comparison within ${Math.round(settings.timeoutMs / 1000)} s (office.renderTimeoutMs). ${MANUAL_COMPARISON}`,
      );
    }
    throw new Error(`Microsoft Word is unavailable: ${powershellError(result) ?? describeFailure(result, settings.timeoutMs)}. ${MANUAL_COMPARISON}`);
  } finally {
    // Retried: a Word just ended may still hold the copies for a moment.
    await fs.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

/**
 * What PowerShell said went wrong: the first line of its error record. The lines after
 * it are the record's decoration — the failing line underlined with `~`, then
 * `CategoryInfo` and `FullyQualifiedErrorId` — which, kept instead, read as noise.
 */
function powershellError(result: ProcessResult): string | undefined {
  const first = result.stderr.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== "");
  return first?.replace(/\.$/, "");
}

/**
 * The answer for Word's compared document: what it is, then the review reading of it.
 *
 * The opening line comes first because the review reading lists an author and a date
 * for every change, and here those are the comparison's — read without the warning,
 * they look like who edited the document and when.
 */
export async function comparisonAnswer(
  compared: Uint8Array,
  names: { original: string; revised: string; written?: string },
): Promise<string> {
  const opening =
    `> Compared by Microsoft Word: "${names.original}" → "${names.revised}". ` +
    "The authors and dates on the changes below are the comparison's, not those of whoever edited the document.";
  const written = names.written === undefined ? [] : [`Saved the compared document, with Word's tracked changes, to \`${names.written}\`.`];

  let extraction: Awaited<ReturnType<typeof extractDocx>>;
  let truncated = false;
  try {
    try {
      extraction = await extractDocx(compared, { review: true, full: true });
    } catch (error) {
      if (!(error instanceof DocxError) || error.reason !== "too-large") throw error;
      extraction = await extractDocx(compared, { review: true });
      truncated = true;
    }
  } catch (error) {
    if (error instanceof DocxError) throw new Error(`Word's compared document could not be read: ${error.message}`);
    throw error;
  }

  if ((extraction.review?.revisions ?? 0) === 0) {
    return [opening, "Word found no difference between the two versions' text (formatting is not compared).", ...written].join("\n\n");
  }
  const rest = !truncated
    ? []
    : names.written !== undefined
      ? [`> Read the rest with docx_extract on \`${names.written}\` with review: true and the blocks named above.`]
      : ["> Call docx_compare again with output_path to keep the compared document, then read the rest with docx_extract, review: true and the blocks named above."];
  return [opening, extraction.markdown, ...rest, ...written].join("\n\n");
}

/* ── docx_compare ───────────────────────────────────────────────────────────── */

export interface DocxCompareToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones both versions must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Zone the compared document's destination must land in; `null` when writing is disabled. */
  writableRoot: string | null;
  /** Largest document Word is handed, in bytes. */
  maxBytes: number;
  render: Pick<RenderSettings, "timeoutMs">;
  /** How Word is run; the real machine unless a test says otherwise. */
  environment?: RenderEnvironment;
}

/**
 * SECURITY — every path is checked here, before Word starts: `scopeToRoot` confines only
 * a parameter named `path`, and this tool has none. Both versions must resolve inside
 * the readable zone, symlinks included, and stay under the Word size ceiling; the
 * destination must be inside the writable zone and free.
 */
export function createDocxCompareToolDefinition(options: DocxCompareToolOptions): ToolDefinition {
  const environment = options.environment ?? defaultEnvironment();
  return {
    name: "docx_compare",
    label: "Compare Word documents",
    description: [
      "Compare two versions of a Word document (.docx) with Microsoft Word, and return what changed in the review reading:",
      "{++inserted++} and {--deleted--} text, moves marked [mN] at both ends, each change listed at the end with its section.",
      "Use it when a document was revised without tracked changes; a document that has them is read with docx_extract and review: true.",
      "Formatting is not compared. The authors and dates on the changes are the comparison's, not the editors'. Neither file is modified.",
      "output_path also saves Word's compared document, for the user to open in Word.",
    ].join(" "),
    promptSnippet: "Compare two versions of a Word document with Word, to see what changed",
    parameters: Type.Object({
      original: Type.String({ description: "The earlier version (.docx)." }),
      revised: Type.String({ description: "The later version (.docx)." }),
      output_path: Type.Optional(Type.String({ description: "Also save Word's compared document at this workspace path (.docx). The file must not already exist." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const p = params as { original: string; revised: string; output_path?: string };
      // Every refusal is knowable now; Word costs seconds to start.
      const original = await readSource(p.original, options, options.maxBytes, "Word");
      const revised = await readSource(p.revised, options, options.maxBytes, "Word");
      let destination: string | undefined;
      if (p.output_path !== undefined) {
        if (!/\.docx$/i.test(p.output_path)) throw new Error(`"${p.output_path}" must end in .docx.`);
        destination = await assertWritableDestination(p.output_path, { cwd: options.cwd, writableRoot: options.writableRoot });
        if (await fs.lstat(destination).then(() => true, () => false)) {
          throw new Error(`"${p.output_path}" already exists; choose another path for the compared document.`);
        }
        // Seen live: an agent named a folder it had not created, and Word ran for nothing.
        if (!(await fs.stat(path.dirname(destination)).then((stat) => stat.isDirectory(), () => false))) {
          throw new Error(`The folder for "${p.output_path}" does not exist.`);
        }
      }

      const compared = await compareWithWord(original.bytes, revised.bytes, options.render, environment, signal);
      if (destination !== undefined) {
        try {
          await fs.writeFile(destination, compared, { flag: "wx" });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EEXIST") throw new Error(`"${p.output_path}" already exists; choose another path for the compared document.`);
          if (code === "ENOENT") throw new Error(`The folder for "${p.output_path}" does not exist.`);
          throw error;
        }
      }
      const text = await comparisonAnswer(compared, {
        original: p.original,
        revised: p.revised,
        ...(p.output_path === undefined ? {} : { written: p.output_path }),
      });
      return { content: [{ type: "text", text }], details: undefined };
    },
  } as ToolDefinition;
}
