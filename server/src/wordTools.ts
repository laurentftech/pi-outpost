/**
 * The four tools that let the agent write Word documents in a house style and check
 * what it wrote:
 *
 * - `docx_styles` — what a template (or a document) offers: the styles written content
 *   will wear, its table styles, its cover page, headers, footers, table of contents;
 * - `docx_create` — a new `.docx` written from Markdown into a template;
 * - `docx_update` — an existing `.docx` changed section by section, as tracked changes
 *   by default;
 * - `docx_render` — the document drawn by an office application (Word on Windows,
 *   LibreOffice, ONLYOFFICE), returned as pictures of its pages with its page count,
 *   its chapters as the PDF's bookmarks, and the text no page shows.
 *
 * SECURITY — every path argument is checked here, because `scopeToRoot` in sandbox.ts
 * confines only a parameter named `path`. Sources (templates, documents, Markdown files,
 * pictures) must resolve inside the readable zone; destinations inside the writable
 * one, which is `null` when writing is disabled. The two writing tools are not
 * registered at all in a read-only sandbox.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PictureSource, ReferencedImage } from "@pi-outpost/shared/docx";
import { createDocument, type KeepPart } from "./docxBuild.ts";
import { describeWordTemplate, formatTemplateDescription, readWordPackage, WordTemplateError } from "./docxTemplate.ts";
import { updateDocument, type DocxEdit } from "./docxUpdate.ts";
import { assertWritableDestination } from "./extractionOutput.ts";
import { ImageError, readImageInfo } from "./imageInfo.ts";
import {
  checkDocumentPdf,
  convertDocumentToPdf,
  defaultEnvironment,
  rasterizePdf,
  rasterizeSvg,
  RENDERER_NAMES,
  RenderError,
  type RenderEnvironment,
  type RendererChoice,
  type RenderSettings,
} from "./presentationRender.ts";
import { MAX_IMAGE_BYTES, readSource } from "./presentationTools.ts";
import { bodyLayout, paragraphText } from "./wordml.ts";

export interface WordToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones a source must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Zone a destination must land in; `null` when writing is disabled. */
  writableRoot: string | null;
  /** Largest template or document these tools will open, in bytes. */
  maxBytes: number;
  render: RenderSettings;
  /** How converters are found and run; the real machine unless a test says otherwise. */
  environment?: RenderEnvironment;
}

/** Page pictures returned by one render call — each one costs the model context. */
export const MAX_RENDERED_PAGES = 8;
/** Width of a returned page picture: enough to read 10 pt text. */
export const RENDER_WIDTH = 1100;
/** Largest Markdown file a tool reads as content. */
export const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024;

/** A 1×1 transparent PNG: the raster behind an SVG when no canvas can draw one. */
const TRANSPARENT_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Whether a Markdown image reference points outside the workspace (a URL, a data URI). */
function isExternal(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//");
}

/**
 * Pictures a document references, read from the workspace.
 *
 * A reference resolves against the Markdown file's folder (or the workspace root for
 * inline content), must land in the readable zone, and is checked like any picture a
 * deck takes: its kind from its bytes, and an SVG refused if drawing it would fetch.
 * A picture that fails any of that is left out and its alt text written instead — the
 * tool's answer names it.
 */
export function sandboxPictures(options: Pick<WordToolOptions, "cwd" | "allowedRoots">, baseDir: string): PictureSource {
  const resolveRef = (src: string): string | undefined => {
    if (isExternal(src)) return undefined;
    let decoded = src.split(/[?#]/)[0];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Not percent-encoded after all: take it as written.
    }
    return path.resolve(baseDir, decoded);
  };
  return {
    imageKey: resolveRef,
    async loadImage(src): Promise<ReferencedImage | undefined> {
      const target = resolveRef(src);
      if (target === undefined) return undefined;
      let bytes: Buffer;
      try {
        bytes = (await readSource(target, options, MAX_IMAGE_BYTES, "picture")).bytes;
      } catch {
        return undefined;
      }
      let info;
      try {
        info = readImageInfo(bytes, src);
      } catch (error) {
        if (error instanceof ImageError) return undefined;
        throw error;
      }
      if (info.kind === "svg") {
        const png = (await rasterizeSvg(bytes, info.width, info.height)) ?? TRANSPARENT_PIXEL;
        return { kind: "vector", image: { svg: bytes.toString("utf8"), png: new Uint8Array(png), width: info.width, height: info.height } };
      }
      return { kind: "raster", type: info.kind === "jpeg" ? "jpg" : info.kind, bytes: new Uint8Array(bytes), width: info.width, height: info.height };
    },
  };
}

/** Markdown given inline or as a workspace file, with the folder its pictures resolve against. */
async function markdownOf(
  inline: string | undefined,
  file: string | undefined,
  options: WordToolOptions,
  what: string,
): Promise<{ markdown: string; baseDir: string }> {
  if ((inline === undefined) === (file === undefined)) throw new Error(`${what}: give either markdown or markdown_path, not both and not neither.`);
  if (inline !== undefined) return { markdown: inline, baseDir: options.cwd };
  const source = await readSource(file!, options, MAX_MARKDOWN_BYTES, "Markdown");
  return { markdown: source.bytes.toString("utf8"), baseDir: path.dirname(source.resolved) };
}

/** Where a new document goes: checked writable, and refused if it exists unless `overwrite`. */
async function prepareDestination(destination: string, overwrite: boolean | undefined, options: WordToolOptions): Promise<{ resolved: string; exists: boolean }> {
  if (!/\.docx$/i.test(destination)) {
    throw new Error(`"${destination}" must end in .docx: the tool writes a Word document, not a template or a macro-enabled file.`);
  }
  const resolved = await assertWritableDestination(destination, { cwd: options.cwd, writableRoot: options.writableRoot });
  const existing = await fs.lstat(resolved).catch(() => null);
  if (existing !== null && overwrite !== true) throw new Error(`"${destination}" already exists. Pass overwrite: true to replace it, or choose another path.`);
  if (existing !== null && !existing.isFile()) throw new Error(`"${destination}" exists and is not a file.`);
  return { resolved, exists: existing !== null };
}

/** Write a new file, or replace one through a sibling and a rename so no reader sees half of it. */
async function writeDocument(resolved: string, exists: boolean, bytes: Buffer, destination: string): Promise<void> {
  if (!exists) {
    try {
      await fs.writeFile(resolved, bytes, { flag: "wx" });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") throw new Error(`"${destination}" already exists. Pass overwrite: true to replace it, or choose another path.`);
      if (code === "ENOENT") throw new Error(`The folder for "${destination}" does not exist.`);
      throw new Error(`Cannot write "${destination}": ${(error as Error).message}`);
    }
    return;
  }
  const staging = `${resolved}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(staging, bytes, { flag: "wx" });
  await fs.rename(staging, resolved).catch(async (error: unknown) => {
    await fs.rm(staging, { force: true });
    throw new Error(`Cannot replace "${destination}": ${(error as Error).message}`);
  });
}

function asToolError(error: unknown, target?: string): never {
  if (error instanceof WordTemplateError) throw new Error(target === undefined ? error.message : `"${target}": ${error.message}`);
  throw error;
}

/* ── docx_styles ────────────────────────────────────────────────────────────── */

export function createDocxStylesToolDefinition(options: WordToolOptions): ToolDefinition {
  return {
    name: "docx_styles",
    label: "Word template styles",
    description: [
      "Describe a Word template (.dotx) or document (.docx): the styles written content will use (headings 1-6 and whether the template numbers them, body text, lists), its table styles, and whether it has a cover page, a header, a footer and a table of contents.",
      "Call it before docx_create to know what the template offers, and whether to keep its cover page and table of contents.",
    ].join(" "),
    promptSnippet: "Describe the styles and parts of a Word template",
    parameters: Type.Object({
      path: Type.String({ description: "The template (.dotx) or document (.docx), relative to the workspace root or absolute." }),
    }),
    async execute(_toolCallId, params) {
      const { path: target } = params as { path: string };
      const { bytes } = await readSource(target, options, options.maxBytes, "template");
      try {
        return { content: [{ type: "text", text: formatTemplateDescription(describeWordTemplate(readWordPackage(bytes))) }], details: undefined };
      } catch (error) {
        asToolError(error, target);
      }
    },
  } as ToolDefinition;
}

/* ── docx_create ────────────────────────────────────────────────────────────── */

export function createDocxCreateToolDefinition(options: WordToolOptions): ToolDefinition {
  return {
    name: "docx_create",
    label: "Create Word document",
    description: [
      "Create a Word document (.docx) from a template (.dotx or .docx) and Markdown: headings, paragraphs, bold/italic, links, lists, tables, block quotes, code, LaTeX equations and pictures (PNG, JPEG, GIF, SVG) are written in the template's own styles, heading numbering, page setup, header, footer and theme.",
      "The template's sample text is left out; keep: [\"cover\", \"toc\"] keeps its cover page and table of contents (Word refreshes the table when the file is opened).",
      "Mermaid diagrams are written as their source; draw them as SVG files and reference those instead.",
      "After creating a document, call docx_render on it and look at the pages before you say it is done.",
    ].join(" "),
    promptSnippet: "Create a Word document from Markdown in a template's styles",
    promptGuidelines: [
      "Before docx_create, call docx_styles on the template to see its styles and whether it has a cover page and a table of contents to keep.",
      "After docx_create, call docx_render and fix what it reports before calling the document finished.",
    ],
    parameters: Type.Object({
      template_path: Type.String({ description: "The template (.dotx or .docx) whose styles, page setup, header and footer the document uses." }),
      output_path: Type.String({ description: "Where to write the new document; must end in .docx." }),
      markdown: Type.Optional(Type.String({ description: "The content, as Markdown. # is a first-level heading." })),
      markdown_path: Type.Optional(Type.String({ description: "A Markdown file to use as the content instead; its pictures resolve against its folder." })),
      keep: Type.Optional(
        Type.Array(Type.Union([Type.Literal("cover"), Type.Literal("toc")]), { description: "Parts of the template's own body to keep in front of the content." }),
      ),
      overwrite: Type.Optional(Type.Boolean({ description: "Replace an existing .docx at output_path — for rewriting after docx_render showed a problem." })),
    }),
    async execute(_toolCallId, params) {
      const p = params as { template_path: string; output_path: string; markdown?: string; markdown_path?: string; keep?: KeepPart[]; overwrite?: boolean };
      // Destination first: a refusal is knowable before anything is read.
      const destination = await prepareDestination(p.output_path, p.overwrite, options);
      const content = await markdownOf(p.markdown, p.markdown_path, options, "docx_create");
      const template = await readSource(p.template_path, options, options.maxBytes, "template");
      let created;
      try {
        created = await createDocument(readWordPackage(template.bytes), content.markdown, {
          ...(p.keep !== undefined ? { keep: p.keep } : {}),
          pictures: sandboxPictures(options, content.baseDir),
        });
      } catch (error) {
        asToolError(error, p.template_path);
      }
      await writeDocument(destination.resolved, destination.exists, created.bytes, p.output_path);
      const lines = [
        `Wrote \`${p.output_path}\` (${created.bytes.length} bytes) from \`${p.template_path}\`.`,
        ...created.warnings.map((warning) => `- Note: ${warning}`),
        "",
        `Next: call docx_render with path "${p.output_path}" and look at the pages.`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
    },
  } as ToolDefinition;
}

/* ── docx_update ────────────────────────────────────────────────────────────── */

const editSchema = Type.Object({
  action: Type.Union([Type.Literal("replace"), Type.Literal("insert_after"), Type.Literal("append"), Type.Literal("delete")], {
    description:
      "replace: new content under an existing heading (the heading stays). insert_after: a new section after a whole section, subsections included. append: at the end of the document. delete: a section with its subsections.",
  }),
  section: Type.Optional(
    Type.String({ description: 'The section, by its heading path: "Scope" or "Scope > Out of scope" (parent > child). Not needed for append.' }),
  ),
  markdown: Type.Optional(Type.String({ description: "The new content, as Markdown (replace, insert_after, append). Start inserted sections with their own heading." })),
  markdown_path: Type.Optional(Type.String({ description: "A Markdown file to use as the new content instead." })),
});

export function createDocxUpdateToolDefinition(options: WordToolOptions): ToolDefinition {
  return {
    name: "docx_update",
    label: "Update Word document",
    description: [
      "Change an existing Word document (.docx) section by section — replace a section's content, insert a section after one, append at the end, delete a section — naming each section by its heading path.",
      "New content is Markdown, written in the document's own styles and numbering. Everything outside the edited sections is left exactly as it was.",
      "Edits are written as tracked changes (attributed to pi-outpost) unless track_changes is false, so the document's owner can review and accept them in Word. A section holding changes nobody accepted yet is refused.",
      "Writes to output_path; replaces the original only with overwrite: true. Read the document with docx_extract first to see its headings, and call docx_render afterwards.",
    ].join(" "),
    promptSnippet: "Change sections of an existing Word document, as tracked changes",
    parameters: Type.Object({
      path: Type.String({ description: "The document to update (.docx)." }),
      edits: Type.Array(editSchema, { description: "The edits, applied together to the document as it is now." }),
      output_path: Type.Optional(Type.String({ description: "Where to write the updated document (.docx). Required unless overwrite is true." })),
      overwrite: Type.Optional(Type.Boolean({ description: "Write the result over output_path if it exists — or over the original when output_path is omitted." })),
      track_changes: Type.Optional(Type.Boolean({ description: "false writes the edits directly instead of as tracked changes. Default: true." })),
    }),
    async execute(_toolCallId, params) {
      const p = params as {
        path: string;
        edits: Array<{ action: DocxEdit["action"]; section?: string; markdown?: string; markdown_path?: string }>;
        output_path?: string;
        overwrite?: boolean;
        track_changes?: boolean;
      };
      if (p.output_path === undefined && p.overwrite !== true) {
        throw new Error("Give output_path for the updated document, or overwrite: true to replace the original.");
      }
      const destinationPath = p.output_path ?? p.path;
      const destination = await prepareDestination(destinationPath, p.overwrite, options);
      const source = await readSource(p.path, options, options.maxBytes, "document");

      const edits: DocxEdit[] = [];
      for (const [index, edit] of p.edits.entries()) {
        const what = `edit ${index + 1}`;
        if (edit.action !== "append" && (edit.section === undefined || edit.section.trim() === "")) throw new Error(`${what}: name the section by its heading.`);
        if (edit.action === "delete") {
          if (edit.markdown !== undefined || edit.markdown_path !== undefined) throw new Error(`${what}: delete takes no content.`);
          edits.push({ action: "delete", section: edit.section! });
          continue;
        }
        const content = await markdownOf(edit.markdown, edit.markdown_path, options, what);
        const pictures = sandboxPictures(options, content.baseDir);
        edits.push(
          edit.action === "append"
            ? { action: "append", markdown: content.markdown, pictures }
            : { action: edit.action, section: edit.section!, markdown: content.markdown, pictures },
        );
      }

      let updated;
      try {
        // Each edit's pictures resolve against the folder of its own content.
        updated = await updateDocument(readWordPackage(source.bytes, "the document"), edits, {
          ...(p.track_changes !== undefined ? { trackChanges: p.track_changes } : {}),
        });
      } catch (error) {
        asToolError(error, p.path);
      }
      await writeDocument(destination.resolved, destination.exists, updated.bytes, destinationPath);
      const removed = updated.removed;
      const lines = [
        `Wrote \`${destinationPath}\` (${updated.bytes.length} bytes):`,
        ...updated.report.map((line) => `- ${line}`),
        ...(removed.controls + removed.fields + removed.comments > 0
          ? [`- ${p.track_changes === false ? "Removed" : "Marked deleted"} with those sections: ${removed.controls} content control(s), ${removed.fields} field(s), ${removed.comments} comment anchor(s).`]
          : []),
        ...updated.warnings.map((warning) => `- Note: ${warning}`),
        "",
        `Next: call docx_render with path "${destinationPath}" and look at the changed pages.`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
    },
  } as ToolDefinition;
}

/* ── docx_render ────────────────────────────────────────────────────────────── */

/** `"3"`, `"2-5"`, `"1,4-6"` → the page numbers that exist, in order. */
export function parsePageRange(spec: string, pageCount: number): number[] {
  const wanted = new Set<number>();
  for (const part of spec.split(",")) {
    const piece = part.trim();
    if (piece === "") continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(piece);
    if (match === null) throw new Error(`"${piece}" is not a page or a page range (use "3", "2-5" or "1,4-6")`);
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) throw new Error(`"${piece}" is not a page range`);
    for (let page = from; page <= Math.min(to, pageCount); page++) wanted.add(page);
  }
  if (wanted.size === 0) throw new Error(`the document has ${pageCount} page(s); "${spec}" names none of them`);
  return [...wanted].sort((a, b) => a - b);
}

const RENDERER_LABELS: Record<string, string> = { word: "Word", powerpoint: "PowerPoint", libreoffice: "LibreOffice", onlyoffice: "ONLYOFFICE" };

export function createDocxRenderToolDefinition(options: WordToolOptions): ToolDefinition {
  const environment = options.environment ?? defaultEnvironment();
  return {
    name: "docx_render",
    label: "Render Word document",
    description: [
      "Render a Word document (.docx) with an office application — Word on Windows, otherwise LibreOffice or ONLYOFFICE — and return pictures of its pages,",
      "its page count, its chapters as the PDF's bookmarks, and any paragraph no page shows. Tracked changes are drawn as markup.",
      "Use it to check a document you wrote or updated: headings in the template's style and numbering, tables that fit the page, pictures in place, nothing lost.",
      "pdf_path also saves the rendering as a PDF.",
    ].join(" "),
    promptSnippet: "Render a Word document to pictures of its pages, to check it",
    parameters: Type.Object({
      path: Type.String({ description: "The document to render (.docx)." }),
      pages: Type.Optional(Type.String({ description: `Pages to return as pictures, e.g. "1" or "2-4,7". Omit for the first ${MAX_RENDERED_PAGES}.` })),
      renderer: Type.Optional(
        Type.Union([Type.Literal("auto"), ...RENDERER_NAMES.filter((name) => name !== "powerpoint").map((name) => Type.Literal(name))], {
          description: "Which application draws the document. auto (the default) tries Word on Windows, then LibreOffice, then ONLYOFFICE.",
        }),
      ),
      pdf_path: Type.Optional(Type.String({ description: "Also save the rendered PDF at this workspace path. The file must not already exist." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const p = params as { path: string; pages?: string; renderer?: RendererChoice; pdf_path?: string };
      if (p.pdf_path !== undefined && !/\.pdf$/i.test(p.pdf_path)) throw new Error(`"${p.pdf_path}" must end in .pdf.`);
      const resolvedPdf = p.pdf_path === undefined ? undefined : await assertWritableDestination(p.pdf_path, { cwd: options.cwd, writableRoot: options.writableRoot });

      const source = await readSource(p.path, options, options.maxBytes, "document");
      let paragraphs: string[];
      try {
        const pkg = readWordPackage(source.bytes, "the document");
        const body = bodyLayout(pkg.documentXml);
        paragraphs = body.children.flatMap((child) =>
          child.local === "sectPr" ? [] : [...child.xml.matchAll(/<(?:\w+:)?p\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?p>)/g)].map((match) => paragraphText(match[0]).trim()),
        ).filter((text) => text !== "");
      } catch (error) {
        asToolError(error, p.path);
      }

      let conversion;
      try {
        conversion = await convertDocumentToPdf(source.resolved, { ...options.render, renderer: p.renderer ?? options.render.renderer }, environment, signal);
      } catch (error) {
        if (error instanceof RenderError) throw new Error(error.message);
        throw error;
      }
      if (resolvedPdf !== undefined) {
        try {
          await fs.writeFile(resolvedPdf, conversion.pdf, { flag: "wx" });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EEXIST") throw new Error(`"${p.pdf_path}" already exists; choose another path for the PDF.`);
          if (code === "ENOENT") throw new Error(`The folder for "${p.pdf_path}" does not exist.`);
          throw error;
        }
      }

      const check = await checkDocumentPdf(conversion.pdf, paragraphs);
      const wanted = p.pages !== undefined ? parsePageRange(p.pages, check.pageCount) : Array.from({ length: check.pageCount }, (_, i) => i + 1);
      const pictured = wanted.slice(0, MAX_RENDERED_PAGES);
      const raster = await rasterizePdf(conversion.pdf, pictured, RENDER_WIDTH);

      const lines: string[] = [`Rendered \`${p.path}\` with ${RENDERER_LABELS[conversion.renderer]}: ${check.pageCount} page(s).`];
      if (conversion.skipped.length > 0) {
        lines.push(`(${conversion.skipped.map((attempt) => `${RENDERER_LABELS[attempt.renderer]} unavailable: ${attempt.failure}`).join("; ")})`);
      }
      if (conversion.renderer !== "word") {
        lines.push(`${RENDERER_LABELS[conversion.renderer]} substitutes fonts this machine lacks, so line and page breaks can differ from Word's.`);
      }
      if (resolvedPdf !== undefined) lines.push(`Saved the PDF to \`${p.pdf_path}\`.`);
      lines.push("");
      lines.push(
        check.outline.length === 0
          ? "Chapters: the PDF has no bookmarks — no paragraph is a heading Word recognises, or the renderer does not export them."
          : ["Chapters (the PDF's bookmarks):", ...check.outline.slice(0, 60).map((entry) => `${"  ".repeat(entry.depth)}- ${entry.title}`), ...(check.outline.length > 60 ? ["  …"] : [])].join("\n"),
      );
      lines.push("");
      lines.push(
        check.missing.length === 0
          ? "Text check: every paragraph of the body is on a page."
          : `Text check — ${check.missing.length} paragraph(s) on no page: ${check.missing
              .slice(0, 6)
              .map((text) => `"${text.length > 60 ? `${text.slice(0, 57)}…` : text}"`)
              .join(", ")}${check.missing.length > 6 ? ", …" : ""}.`,
      );
      lines.push("");
      lines.push(
        raster === null
          ? "No page pictures: this installation has no canvas to draw them with (the optional @napi-rs/canvas package is missing). Rely on the checks above, or open the PDF."
          : "Look at each page for: headings in the template's style and numbering, tables wider than the page, pictures out of place, leftover sample text, and tracked changes where you expect them." +
              (wanted.length > pictured.length ? ` Pictures cover pages ${pictured.join(", ")}; ask for others with pages="${wanted[pictured.length]}-${wanted[wanted.length - 1]}".` : ""),
      );
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [{ type: "text", text: lines.join("\n") }];
      for (const image of raster?.images ?? []) {
        content.push({ type: "text", text: `Page ${image.page}:` });
        content.push({ type: "image", data: image.png.toString("base64"), mimeType: "image/png" });
      }
      return { content, details: undefined };
    },
  } as ToolDefinition;
}
