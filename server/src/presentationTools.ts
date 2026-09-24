/**
 * The three tools that let the agent make a PowerPoint deck from a template and
 * check that it can be read:
 *
 * - `pptx_layouts` — the layouts a template offers and what each can hold;
 * - `pptx_create` — a new deck built into those layouts: titles, bullets, pictures;
 * - `pptx_render` — the deck drawn by an office application (PowerPoint on Windows,
 *   LibreOffice, or ONLYOFFICE), returned as pictures of the slides together with a
 *   list of the text that did not make it onto them.
 *
 * The loop the skill teaches is create → render → look → fix → create again; the
 * render is what turns "the markup is right" into "the slides read".
 *
 * SECURITY — every path argument is checked here, because `scopeToRoot` in
 * sandbox.ts confines only a parameter named `path`. Sources (the template, the
 * pictures, the deck to render) must resolve inside the readable zone; destinations
 * (`output_path`, `pdf_path`) inside the writable one, which is `null` when writing
 * is disabled. `pptx_create` is not registered at all in a read-only sandbox.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { assertWritableDestination } from "./extractionOutput.ts";
import { ImageError, readImageInfo } from "./imageInfo.ts";
import { PptxError, parseSlideRange, readSlideParagraphs } from "./pptx.ts";
import { buildPresentation, describeTemplate, PptxBuildError, readTemplate, type SlideSpec } from "./pptxBuild.ts";
import {
  convertPresentationToPdf,
  countPdfPages,
  defaultEnvironment,
  findUnreadableText,
  rasterizePdf,
  rasterizeSvg,
  RENDERER_NAMES,
  RenderError,
  type RenderEnvironment,
  type RendererChoice,
  type RenderSettings,
} from "./presentationRender.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";

export interface PresentationToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones a source must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Zone a destination must land in; `null` when writing is disabled. */
  writableRoot: string | null;
  /** Largest template or presentation these tools will open, in bytes. */
  maxBytes: number;
  render: RenderSettings;
  /** How converters are found and run; the real machine unless a test says otherwise. */
  environment?: RenderEnvironment;
}

/** Largest picture a slide may carry. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Slide pictures returned by one render call — each one costs the model context. */
export const MAX_RENDERED_SLIDES = 12;
/** Width of a returned slide picture: enough to read 12 pt text, small enough to send a dozen. */
export const RENDER_WIDTH = 1280;

function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Resolve a source path and refuse it outside the readable zone or past `maxBytes`. */
async function readSource(target: string, options: PresentationToolOptions, maxBytes: number, what: string): Promise<{ resolved: string; bytes: Buffer }> {
  const resolved = await realResolve(path.resolve(options.cwd, target));
  if (!isWithinAny(options.allowedRoots, resolved)) {
    throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat === null || !stat.isFile()) throw new Error(`No such file: ${target}`);
  if (stat.size > maxBytes) throw new Error(`"${target}" is larger than the ${describeSize(maxBytes)} ${what} limit`);
  return { resolved, bytes: await fs.readFile(resolved) };
}

/* ── pptx_layouts ───────────────────────────────────────────────────────────── */

const layoutsParameters = Type.Object({
  path: Type.String({ description: "The template: a .potx or .pptx file (relative to the workspace root, or absolute)" }),
});

export function createPptxLayoutsToolDefinition(options: PresentationToolOptions): ToolDefinition {
  return {
    name: "pptx_layouts",
    label: "Template layouts",
    description: [
      "List the slide layouts of a PowerPoint template (.potx or .pptx): each layout's name, its type, and the placeholders it offers (title, subtitle, content, text, picture).",
      "Call it before pptx_create to choose a layout for each slide by name.",
    ].join(" "),
    promptSnippet: "List the slide layouts a PowerPoint template offers",
    parameters: layoutsParameters,
    async execute(_toolCallId, params) {
      const { path: target } = params as { path: string };
      const { bytes } = await readSource(target, options, options.maxBytes, "template");
      try {
        const template = readTemplate(bytes);
        return { content: [{ type: "text", text: describeTemplate(template) }], details: undefined };
      } catch (error) {
        if (error instanceof PptxBuildError) throw new Error(`"${target}": ${error.message}`);
        throw error;
      }
    },
  } as ToolDefinition;
}

/* ── pptx_create ────────────────────────────────────────────────────────────── */

const slideSchema = Type.Object({
  layout: Type.Optional(
    Type.String({ description: "Layout name as pptx_layouts lists it (e.g. \"Title and Content\"). Omit to let the tool choose from the slide's content." }),
  ),
  title: Type.Optional(Type.String({ description: "Slide title. A newline starts a new line." })),
  subtitle: Type.Optional(Type.String({ description: "Subtitle, for title and section slides." })),
  bullets: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "One string per bullet. Indent with two spaces per level for sub-bullets. Do not type a bullet character — the template draws it. **text** makes text bold.",
    }),
  ),
  image: Type.Optional(
    Type.Object({
      path: Type.String({ description: "A PNG, JPEG, GIF or SVG file in the workspace." }),
      alt: Type.Optional(Type.String({ description: "Alternative text read by screen readers." })),
    }),
  ),
});

const createParameters = Type.Object({
  template_path: Type.String({ description: "The template (.potx or .pptx) whose masters, layouts, theme and fonts the deck uses." }),
  output_path: Type.String({ description: "Where to write the new deck; must end in .pptx." }),
  slides: Type.Array(slideSchema, { description: "The slides, in order." }),
  overwrite: Type.Optional(
    Type.Boolean({ description: "Replace an existing .pptx at output_path — for rebuilding a deck after pptx_render showed a problem." }),
  ),
});

interface SlideParam {
  layout?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  image?: { path: string; alt?: string };
}

export function createPptxCreateToolDefinition(options: PresentationToolOptions): ToolDefinition {
  return {
    name: "pptx_create",
    label: "Create presentation",
    description: [
      "Create a PowerPoint deck (.pptx) from a template (.potx or .pptx): each slide uses one of the template's layouts, and its title, subtitle, bullets and picture go into that layout's placeholders, so they take the template's fonts, colours and positions.",
      "The template's own sample slides are left out. Pictures may be PNG, JPEG, GIF or SVG.",
      "After creating a deck, call pptx_render on it and look at every slide before you say it is done.",
    ].join(" "),
    promptSnippet: "Create a PowerPoint deck from a template's layouts",
    promptGuidelines: [
      "Before pptx_create, call pptx_layouts on the template and pick each slide's layout by name.",
      "After pptx_create, call pptx_render and fix every slide it reports before calling the deck finished.",
    ],
    parameters: createParameters,
    async execute(_toolCallId, params) {
      const {
        template_path: templatePath,
        output_path: destination,
        slides,
        overwrite,
      } = params as { template_path: string; output_path: string; slides: SlideParam[]; overwrite?: boolean };

      if (!/\.pptx$/i.test(destination)) {
        throw new Error(`"${destination}" must end in .pptx: the tool writes a presentation, not a template or a macro-enabled file.`);
      }
      // Destination first: a refusal is knowable before anything is read.
      const resolvedOutput = await assertWritableDestination(destination, { cwd: options.cwd, writableRoot: options.writableRoot });
      const existing = await fs.lstat(resolvedOutput).catch(() => null);
      if (existing !== null && overwrite !== true) {
        throw new Error(`"${destination}" already exists. Pass overwrite: true to replace it, or choose another path.`);
      }
      if (existing !== null && !existing.isFile()) throw new Error(`"${destination}" exists and is not a file.`);

      const template = await readSource(templatePath, options, options.maxBytes, "template");
      const specs: SlideSpec[] = [];
      for (const [index, slide] of slides.entries()) {
        const spec: SlideSpec = {
          ...(slide.layout !== undefined ? { layout: slide.layout } : {}),
          ...(slide.title !== undefined ? { title: slide.title } : {}),
          ...(slide.subtitle !== undefined ? { subtitle: slide.subtitle } : {}),
          ...(slide.bullets !== undefined ? { bullets: slide.bullets } : {}),
        };
        if (slide.image !== undefined) {
          const image = await readSource(slide.image.path, options, MAX_IMAGE_BYTES, "picture");
          try {
            spec.image = { name: slide.image.path, bytes: image.bytes, info: readImageInfo(image.bytes, slide.image.path), ...(slide.image.alt !== undefined ? { alt: slide.image.alt } : {}) };
          } catch (error) {
            if (error instanceof ImageError) throw new Error(`Slide ${index + 1}: ${error.message}`);
            throw error;
          }
        }
        specs.push(spec);
      }

      let built: Awaited<ReturnType<typeof buildPresentation>>;
      try {
        built = await buildPresentation(readTemplate(template.bytes), specs, { rasterizeSvg });
      } catch (error) {
        if (error instanceof PptxBuildError) throw new Error(error.message);
        throw error;
      }

      if (existing === null) {
        try {
          await fs.writeFile(resolvedOutput, built.bytes, { flag: "wx" });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EEXIST") throw new Error(`"${destination}" already exists. Pass overwrite: true to replace it, or choose another path.`);
          if (code === "ENOENT") throw new Error(`The folder for "${destination}" does not exist.`);
          throw new Error(`Cannot write "${destination}": ${(error as Error).message}`);
        }
      } else {
        // Replace through a sibling and a rename, so a reader never sees half a deck.
        const staging = `${resolvedOutput}.${randomBytes(6).toString("hex")}.tmp`;
        await fs.writeFile(staging, built.bytes, { flag: "wx" });
        await fs.rename(staging, resolvedOutput).catch(async (error: unknown) => {
          await fs.rm(staging, { force: true });
          throw new Error(`Cannot replace "${destination}": ${(error as Error).message}`);
        });
      }

      const lines = [
        `Wrote ${built.slides.length} slide(s) to \`${destination}\` (${built.bytes.length} bytes).`,
        "",
        ...built.slides.map(
          (slide) => `- Slide ${slide.number}: ${slide.layout}${slide.warnings.length > 0 ? ` — ${slide.warnings.join("; ")}` : ""}`,
        ),
        "",
        `Next: call pptx_render with path "${destination}" and look at every slide.`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
    },
  } as ToolDefinition;
}

/* ── pptx_render ────────────────────────────────────────────────────────────── */

const renderParameters = Type.Object({
  path: Type.String({ description: "The presentation to render (.pptx)." }),
  slides: Type.Optional(
    Type.String({ description: `Slides to return as pictures, e.g. "3" or "2-5,8". Omit for the first ${MAX_RENDERED_SLIDES}.` }),
  ),
  renderer: Type.Optional(
    Type.Union([Type.Literal("auto"), ...RENDERER_NAMES.map((name) => Type.Literal(name))], {
      description: "Which application draws the slides. auto (the default) tries PowerPoint on Windows, then LibreOffice, then ONLYOFFICE.",
    }),
  ),
  pdf_path: Type.Optional(Type.String({ description: "Also save the rendered PDF at this workspace path. The file must not already exist." })),
});

const RENDERER_LABELS: Record<string, string> = { powerpoint: "PowerPoint", libreoffice: "LibreOffice", onlyoffice: "ONLYOFFICE" };

export function createPptxRenderToolDefinition(options: PresentationToolOptions): ToolDefinition {
  const environment = options.environment ?? defaultEnvironment();
  return {
    name: "pptx_render",
    label: "Render presentation",
    description: [
      "Render a PowerPoint deck (.pptx) with an office application — PowerPoint on Windows, otherwise LibreOffice or ONLYOFFICE — and return a picture of each slide,",
      "together with the text that is on a slide but not visible once drawn (overflow, clipping) and text drawn at the edge of the slide.",
      "Use it to check that a deck is readable: look for overflowing or clipped text, overlaps, text too small to read, poor contrast and leftover placeholder text.",
      "pdf_path also saves the rendering as a PDF.",
    ].join(" "),
    promptSnippet: "Render a PowerPoint deck to pictures of its slides, to check it is readable",
    parameters: renderParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const {
        path: target,
        slides,
        renderer,
        pdf_path: pdfDestination,
      } = params as { path: string; slides?: string; renderer?: RendererChoice; pdf_path?: string };

      if (pdfDestination !== undefined && !/\.pdf$/i.test(pdfDestination)) throw new Error(`"${pdfDestination}" must end in .pdf.`);
      const resolvedPdf =
        pdfDestination === undefined ? undefined : await assertWritableDestination(pdfDestination, { cwd: options.cwd, writableRoot: options.writableRoot });

      const source = await readSource(target, options, options.maxBytes, "presentation");
      let expected: string[][];
      try {
        expected = readSlideParagraphs(source.bytes);
      } catch (error) {
        if (error instanceof PptxError) throw new Error(`"${target}": ${error.message}`);
        throw error;
      }
      const slideCount = expected.length;
      if (slideCount === 0) throw new Error(`"${target}" has no slides to render.`);
      const wanted = slides !== undefined ? parseSlideRange(slides, slideCount) : Array.from({ length: slideCount }, (_, i) => i + 1);
      const pictured = wanted.slice(0, MAX_RENDERED_SLIDES);

      let conversion: Awaited<ReturnType<typeof convertPresentationToPdf>>;
      try {
        conversion = await convertPresentationToPdf(
          source.resolved,
          { ...options.render, renderer: renderer ?? options.render.renderer },
          environment,
          signal,
        );
      } catch (error) {
        if (error instanceof RenderError) throw new Error(error.message);
        throw error;
      }

      if (resolvedPdf !== undefined) {
        try {
          await fs.writeFile(resolvedPdf, conversion.pdf, { flag: "wx" });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EEXIST") throw new Error(`"${pdfDestination}" already exists; choose another path for the PDF.`);
          if (code === "ENOENT") throw new Error(`The folder for "${pdfDestination}" does not exist.`);
          throw error;
        }
      }

      const raster = await rasterizePdf(conversion.pdf, pictured, RENDER_WIDTH);
      const pageCount = raster?.pageCount ?? (await countPdfPages(conversion.pdf));
      // Every slide is checked, not only the pictured ones: the text check is cheap.
      const findings = await findUnreadableText(conversion.pdf, expected, wanted);

      const header: string[] = [`Rendered \`${target}\` with ${RENDERER_LABELS[conversion.renderer]}: ${pageCount} page(s) for ${slideCount} slide(s).`];
      if (conversion.skipped.length > 0) {
        header.push(`(${conversion.skipped.map((attempt) => `${RENDERER_LABELS[attempt.renderer]} unavailable: ${attempt.failure}`).join("; ")})`);
      }
      if (conversion.renderer !== "powerpoint") {
        header.push(
          `${RENDERER_LABELS[conversion.renderer]} substitutes fonts this machine lacks, so line breaks can differ a little from PowerPoint's — leave some room rather than filling a box to the edge.`,
        );
      }
      if (pageCount !== slideCount) header.push(`Warning: ${pageCount} page(s) for ${slideCount} slide(s) — the renderer dropped or split slides.`);
      if (resolvedPdf !== undefined) header.push(`Saved the PDF to \`${pdfDestination}\`.`);
      header.push("");
      if (findings.length === 0) {
        header.push(`Text check: every paragraph of slides ${describeList(wanted)} is visible on the rendered page.`);
      } else {
        header.push("Text check — fix these before calling the deck finished:");
        for (const finding of findings) {
          if (finding.missing.length > 0) {
            header.push(
              `- Slide ${finding.slide}: ${finding.missing.length} paragraph(s) not fully visible (overflow or clipping): ${finding.missing
                .slice(0, 4)
                .map((text) => `"${text.length > 60 ? `${text.slice(0, 57)}…` : text}"`)
                .join(", ")}${finding.missing.length > 4 ? ", …" : ""}. Shorten the text, split the slide, or choose a layout with more room.`,
            );
          }
          if (finding.atEdge) header.push(`- Slide ${finding.slide}: text is drawn at the edge of the slide.`);
        }
      }
      header.push("");
      header.push(
        raster === null
          ? "No slide pictures: this installation has no canvas to draw them with (the optional @napi-rs/canvas package is missing). Rely on the text check, or open the PDF."
          : `Look at each picture for: text that overflows or is cut off, overlapping elements, text too small or too low in contrast to read, and leftover placeholder text.` +
              (wanted.length > pictured.length ? ` Pictures cover slides ${describeList(pictured)}; ask for the rest with slides="${wanted[pictured.length]}-${wanted[wanted.length - 1]}".` : ""),
      );

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
        { type: "text", text: header.join("\n") },
      ];
      for (const image of raster?.images ?? []) {
        content.push({ type: "text", text: `Slide ${image.page}:` });
        content.push({ type: "image", data: image.png.toString("base64"), mimeType: "image/png" });
      }
      return { content, details: undefined };
    },
  } as ToolDefinition;
}

function describeList(numbers: number[]): string {
  if (numbers.length === 0) return "none";
  const contiguous = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
  return contiguous && numbers.length > 1 ? `${numbers[0]}-${numbers[numbers.length - 1]}` : numbers.join(", ");
}
