/**
 * The `pptx_extract` tool: a presentation's slide text and declared tables, as
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
import { imagesParameter, pictureContentFor, type PictureRequest } from "./extractedPictures.ts";
import { assertWritableDestination, excerptOf, extractionSummary, writeExtraction } from "./extractionOutput.ts";
import { PptxError, extractPptx } from "./pptx.ts";
import { rasterizeSvg } from "./presentationRender.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";

export interface PptxToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones the resolved path must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Largest presentation this tool will open, in bytes. */
  maxBytes: number;
  /**
   * Zone `output_path` must land in. `null` means writing is disabled, and every
   * destination is refused — reading is unaffected.
   */
  writableRoot: string | null;
}

const parameters = Type.Object({
  path: Type.String({ description: "Path to the .pptx file (relative to the workspace root, or absolute)" }),
  slides: Type.Optional(
    Type.String({
      description: 'Slides to read, e.g. "12", "5-40" or "5-40,80". Slide numbers are the presentation\'s running order. Omit to start at the first.',
    }),
  ),
  full: Type.Optional(
    Type.Boolean({
      description: "Return the whole presentation in one call instead of the first slides. Refused if it is too large for one answer — use output_path then.",
    }),
  ),
  output_path: Type.Optional(
    Type.String({
      description: "Write the whole extraction to this workspace path and return a summary instead of the content. The file must not already exist.",
    }),
  ),
  images: imagesParameter,
});

const DESCRIPTION = [
  "Extract a PowerPoint (.pptx) presentation as markdown: each slide numbered in the order it is presented, with its text and the rows and columns of any table it declares.",
  "If the user wants the presentation saved, converted, or written anywhere, pass output_path: it writes every slide there in one call and returns a short summary.",
  "Do not return the content and then write it yourself — that spends the context twice.",
  "Otherwise output is capped per call — when it is truncated it says so and names the slide range to ask for next, or pass full:true to get everything at once.",
  "Slide order is the presentation's own, not the order of the files inside the package.",
  "Each picture is named where the slide puts it, as [picture 3: PNG 800×600 — \"its alt text\"]; pass images: \"all\" to get them as images too, or images: [\"3\"] for one by its number.",
  "Charts, SmartArt, animations, speaker notes, comments and embedded media are not read, and are not pictures — there are no bytes to return for them; call pptx_render to see a slide as it looks. A slide holding only those says so.",
].join(" ");

/** Past this, an answer is large enough that the file option is worth naming again. */
const LARGE_ANSWER_CHARS = 60_000;

/** A limit is only actionable if it reads like one: "25 MB", not "0 MB". */
function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function createPptxExtractToolDefinition(options: PptxToolOptions): ToolDefinition {
  return {
    name: "pptx_extract",
    label: "Presentation",
    description: DESCRIPTION,
    promptSnippet: "Read the slides and tables of a PowerPoint presentation",
    promptGuidelines: [
      "Use pptx_extract to read a .pptx file — read/grep return its compressed bytes, not its content.",
      "When the user asks for a presentation to be saved or converted to a file, give the extraction tool an output_path instead of returning the content and writing it afterwards.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const {
        path: target,
        slides,
        full,
        output_path: destination,
        images = "none",
      } = params as { path: string; slides?: string; full?: boolean; output_path?: string; images?: PictureRequest };

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
        throw new Error(`"${target}" is larger than the ${describeSize(options.maxBytes)} presentation limit`);
      }

      // Checked before any parsing: a refusal is knowable now, and spending the
      // parse first only to refuse afterwards wastes it.
      if (destination !== undefined) {
        await assertWritableDestination(destination, { cwd: options.cwd, writableRoot: options.writableRoot });
      }

      // A destination writes the whole presentation: a file holding the first
      // slides of a long deck looks finished, which is worse than no file at all.
      const wholePresentation = full === true || destination !== undefined;

      let extraction: Awaited<ReturnType<typeof extractPptx>>;
      try {
        extraction = await extractPptx(new Uint8Array(await fs.readFile(resolved)), {
          ...(slides === undefined ? {} : { slides }),
          ...(wholePresentation ? { full: true } : {}),
        });
      } catch (error) {
        // The reason is the useful part: "password-protected" and "not a
        // presentation" call for different next moves, and neither is worth retrying.
        if (error instanceof PptxError) throw new Error(error.message);
        throw error;
      }

      // Pictures are selected before the answer is assembled, so an identifier that
      // names nothing is refused instead of returning text that looks complete.
      const pictures = await pictureContentFor(extraction.pictures, images, rasterizeSvg);

      if (destination === undefined) {
        // A very large answer is the moment output_path becomes worth knowing about:
        // saying so here reaches the caller when the cost is in front of it, which a
        // tool description read once at session start does not.
        const text =
          extraction.markdown.length > LARGE_ANSWER_CHARS
            ? `${extraction.markdown}\n\n> This answer is ${extraction.markdown.length} characters. ` +
              `For a presentation this size, pass output_path next time to write it to a file instead.`
            : extraction.markdown;
        return {
          content: [{ type: "text", text: [text, ...pictures.notes.map((note) => `> ${note}`)].join("\n\n") }, ...pictures.blocks],
          details: undefined,
        };
      }

      const written = await writeExtraction(destination, extraction.markdown, {
        cwd: options.cwd,
        writableRoot: options.writableRoot,
      });
      const summary = extractionSummary(written, {
        covered: `${extraction.slides.length} of ${extraction.slideCount} slides`,
        excerpt: excerptOf(extraction.markdown),
      });
      // Pictures still come back when they were asked for: the file holds the markers,
      // and a caller that wanted the bytes wanted them whichever way the text went.
      return {
        content: [{ type: "text", text: [summary, ...pictures.notes.map((note) => `> ${note}`)].join("\n\n") }, ...pictures.blocks],
        details: undefined,
      };
    },
  } as ToolDefinition;
}
