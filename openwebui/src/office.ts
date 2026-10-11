/**
 * Word documents and PowerPoint decks written from one tool call, with pi-outpost's
 * builders (`@pi-outpost/office`).
 *
 * Nothing is stored and nothing is fetched: the content, its pictures (as `data:` URIs)
 * and its diagrams travel in the call; the file travels back inside the embed. The
 * only thing read from disk is the administrator's templates folder, by name.
 *
 * The model never sees the file, nor the embed. So whatever the builders would do
 * quietly about a part they cannot write — a diagram left as its source, a picture as
 * its alt text — is a refusal here: the 200 answer means the whole document was written
 * as asked, and a refusal says what to correct.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DiagramImage } from "@pi-outpost/shared/docx";
import { parseMarkdown } from "@pi-outpost/shared/docx";
import { structuredExchangeBlockRanges } from "@pi-outpost/shared/structured-exchange/reply-blocks";
import { describeFigureRefusal, figureForEnvelope } from "@pi-outpost/shared/structured-exchange/export";
import { FIGURE_FONT } from "@pi-outpost/shared/structured-exchange/figure";
import { tableExport, tableMarkdown } from "@pi-outpost/shared/structured-exchange/table-export";
import type { StructuredTableData } from "@pi-outpost/shared/structured-exchange";
import type { StructuredExchangeIssue } from "@pi-outpost/shared/structured-exchange/parse";
import { judgeStructure } from "@pi-outpost/apps-core/structure";
import { guideTopicFor } from "@pi-outpost/apps-core/guide";
import { createDocument, type KeepPart } from "@pi-outpost/office/docxBuild.ts";
import { describeWordTemplate, readWordPackage, WordTemplateError, type WordPackage } from "@pi-outpost/office/docxTemplate.ts";
import { defaultWordTemplateBytes, DEFAULT_WORD_TEMPLATE_NAME } from "@pi-outpost/office/defaultWordTemplate.ts";
import { buildPresentation, describeTemplate, PptxBuildError, readTemplate, type SlideImage, type SlideSpec } from "@pi-outpost/office/pptxBuild.ts";
import { defaultTemplateBytes, DEFAULT_TEMPLATE_NAME } from "@pi-outpost/office/defaultTemplate.ts";
import { callPictures, readPictureDataUri, type PictureRefusal } from "@pi-outpost/office/callPictures.ts";
import { documentHeadings, updateDocument, type DocxEdit } from "@pi-outpost/office/docxUpdate.ts";
import { slideTitles, updatePresentation, type DeckEdit } from "@pi-outpost/office/pptxUpdate.ts";
import { DEFAULT_MERMAID_FONT, MermaidError, type MermaidRenderer } from "@pi-outpost/office/mermaidRender.ts";
import { RasterError, rasterizeSvg } from "@pi-outpost/office/svgRaster.ts";
import { readImageInfo } from "@pi-outpost/office/imageInfo.ts";

export type OfficeFormat = "word" | "powerpoint";

/** A call the server will not write, said to the model: what to correct, and where. */
export class OfficeRefusal extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly status = 422,
  ) {
    super(message);
    this.name = "OfficeRefusal";
  }
}

export interface OfficeSettings {
  templatesDir: string | undefined;
  maxFileBytes: number;
  maxImageBytes: number;
  mermaid: MermaidRenderer;
  font?: string;
}

/** What the embed shows beside the download: the file's shape, so the user knows what they are getting. */
export interface WrittenFile {
  fileName: string;
  mediaType: string;
  bytes: Buffer;
  /** Headings (Word) or slide titles (PowerPoint), in order. */
  outline: { level: number; text: string }[];
  /** The figures drawn into it, by title or by kind and position. */
  figures: string[];
  template: string;
}

export const WORD_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const POWERPOINT_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const FORMATS: Record<string, OfficeFormat> = { ".dotx": "word", ".docx": "word", ".potx": "powerpoint", ".pptx": "powerpoint" };
const FORMAT_WORD: Record<OfficeFormat, string> = { word: "Word", powerpoint: "PowerPoint" };

/* ── File names ─────────────────────────────────────────────────────────────── */

const MAX_FILE_NAME_CHARS = 120;

/**
 * The name the download gets: the one given, with its extension. A name, never a path:
 * the file is handed to the browser, which decides where it goes.
 */
export function downloadName(given: unknown, extension: ".docx" | ".pptx"): string {
  if (typeof given !== "string" || given.trim() === "") throw new OfficeRefusal(`file_name is required: the name the user downloads, such as "report${extension}"`);
  let name = given.trim();
  if (/[/\\]/.test(name) || name.split(".").every((part) => part === "")) throw new OfficeRefusal(`file_name is a name, not a path: "${given}"`);
  // Control characters and the ones Windows refuses in a file name: matching control
  // characters is the point here.
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>:"|?*]/.test(name)) throw new OfficeRefusal(`file_name holds a character a file name cannot have: "${given}"`);
  const other = extension === ".docx" ? /\.(pptx|potx)$/i : /\.(docx|dotx)$/i;
  if (other.test(name)) throw new OfficeRefusal(`file_name ends in ${name.slice(name.lastIndexOf("."))}, but this tool writes ${extension}`);
  if (!name.toLowerCase().endsWith(extension)) name += extension;
  if (name.length > MAX_FILE_NAME_CHARS) throw new OfficeRefusal(`file_name is longer than ${MAX_FILE_NAME_CHARS} characters`);
  return name;
}

/* ── Templates ──────────────────────────────────────────────────────────────── */

export interface ListedTemplate {
  name: string;
  format: OfficeFormat;
}

/** The templates folder's Word and PowerPoint files, by name. Regular files only. */
export async function listTemplates(dir: string | undefined): Promise<ListedTemplate[]> {
  if (dir === undefined) return [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && FORMATS[path.extname(entry.name).toLowerCase()] !== undefined)
    .map((entry) => ({ name: entry.name, format: FORMATS[path.extname(entry.name).toLowerCase()] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A template's bytes, by the name the model gave. The name is matched against the
 * folder's own entries, so nothing it says can reach outside the folder.
 */
async function templateBytes(settings: OfficeSettings, given: unknown, format: OfficeFormat): Promise<{ name: string; bytes: Buffer } | undefined> {
  if (given === undefined || given === null || given === "") return undefined;
  const listed = await listTemplates(settings.templatesDir);
  const names = listed.map((template) => template.name);
  const offered = { templates: listed.filter((template) => template.format === format).map((template) => template.name) };
  if (typeof given !== "string") throw new OfficeRefusal("template, when given, is a template's file name from list_templates", offered);
  if (/[/\\]/.test(given) || given.includes("..")) throw new OfficeRefusal(`template is a name from list_templates, not a path: "${given}"`, offered);
  const found = listed.find((template) => template.name === given);
  if (found === undefined) {
    throw new OfficeRefusal(
      names.length === 0 ? `there is no template "${given}": no templates are provided here, so leave template out to use the built-in one` : `there is no template "${given}"`,
      offered,
    );
  }
  if (found.format !== format) {
    throw new OfficeRefusal(`"${given}" is a ${FORMAT_WORD[found.format]} template; this tool needs a ${FORMAT_WORD[format]} one`, offered);
  }
  return { name: found.name, bytes: await fs.readFile(path.join(settings.templatesDir!, found.name)) };
}

/** What each template offers, for `list_templates`: Word styles, PowerPoint layouts. */
export async function describeTemplates(settings: OfficeSettings): Promise<Record<string, unknown>[]> {
  const described: Record<string, unknown>[] = [];
  for (const template of await listTemplates(settings.templatesDir)) {
    const bytes = await fs.readFile(path.join(settings.templatesDir!, template.name));
    try {
      if (template.format === "word") {
        const description = describeWordTemplate(readWordPackage(bytes));
        described.push({
          name: template.name,
          format: template.format,
          styles: description.roles.filter((role) => role.style !== undefined).map((role) => `${role.role}: ${role.style!.name}`),
          table_styles: description.tableStyles.map((style) => style.name),
          cover_page: description.features.cover,
          table_of_contents: description.features.tableOfContents,
        });
      } else {
        described.push({ name: template.name, format: template.format, layouts: describeTemplate(readTemplate(bytes)) });
      }
    } catch (error) {
      described.push({ name: template.name, format: template.format, unusable: error instanceof Error ? error.message : String(error) });
    }
  }
  return described;
}

/* ── Diagrams ───────────────────────────────────────────────────────────────── */

/** A structured-exchange document the gate refused, named so the model can find it. */
interface DiagramRefusal {
  position: number;
  title?: string;
  issues: StructuredExchangeIssue[];
  guide: string;
}

function titleOf(envelope: { data: unknown }): string | undefined {
  const title = (envelope.data as { title?: unknown } | null)?.title;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : undefined;
}

type Drawn =
  | { kind: "figure"; image: DiagramImage; title?: string }
  | { kind: "table"; markdown: string; rows: string[][]; title?: string };

/**
 * A structured-exchange document drawn as `show_structure` draws it: a graph,
 * sequence or timeline as its figure, a table as Markdown, to become a native table.
 */
function drawStructure(document: unknown, position: number, font: string): Drawn | DiagramRefusal {
  const verdict = judgeStructure(document);
  if (!verdict.valid) {
    const title = typeof document === "string" ? undefined : titleOf(document as { data: unknown });
    return { position, ...(title ? { title } : {}), issues: verdict.issues, guide: guideTopicFor(document, verdict.issues) };
  }
  const title = titleOf(verdict.envelope);
  if (verdict.envelope.kind === "table") {
    const data = verdict.envelope.data as StructuredTableData;
    const exported = tableExport(data, new Set());
    const rows = [exported.columns, ...exported.rows.map((row) => row.map((cell) => (cell === null ? "" : String(cell))))];
    return { kind: "table", markdown: tableMarkdown(data), rows, ...(title ? { title } : {}) };
  }
  const figure = figureForEnvelope(verdict.envelope);
  if (!figure.ok) {
    const issue = { rule: "figure", path: "", message: describeFigureRefusal(figure) } as StructuredExchangeIssue;
    return { position, ...(title ? { title } : {}), issues: [issue], guide: guideTopicFor(document, [issue]) };
  }
  const svg = forOfficeReaders(figure.svg);
  const info = readImageInfo(Buffer.from(svg, "utf8"), `diagram ${position}`);
  let png: Uint8Array;
  try {
    png = rasterizeSvg(svg, font);
  } catch (error) {
    // The server's fault, not the document's: said as such, so the model does not
    // rewrite a diagram that was right.
    if (error instanceof RasterError) throw new OfficeRefusal(`Nothing was written: this server could not draw diagram ${position}: ${error.message}. Tell the user; rewriting the diagram will not help.`, {}, 500);
    throw error;
  }
  return { kind: "figure", image: { svg, png, width: info.width, height: info.height }, ...(title ? { title } : {}) };
}

/**
 * A figure's SVG for a file, with a named face first in its font list.
 *
 * The figure names `system-ui` first, which a browser resolves; ONLYOFFICE reads only the
 * first family, knows no `system-ui`, and drew every label in a serif face. In a file the
 * list starts with Arial (Word on Windows has it; elsewhere Helvetica and Liberation Sans
 * share its metrics); on screen the figure is unchanged.
 */
export function forOfficeReaders(svg: string): string {
  return svg.replaceAll(`font-family="${FIGURE_FONT}"`, `font-family="Arial, Helvetica, Liberation Sans, sans-serif"`);
}

function refuseDiagrams(refused: DiagramRefusal[]): never {
  const first = refused[0];
  const named = (refusal: DiagramRefusal) => `diagram ${refusal.position}${refusal.title ? ` ("${refusal.title}")` : ""}`;
  throw new OfficeRefusal(
    `Nothing was written: the structured-exchange contract refused ${refused.map(named).join(", ")}. This message is for you, not for the user: correct ${refused.length === 1 ? "that diagram" : "those diagrams"} using the issues below and call again now, in this same reply.` +
      ` If a rule is unclear, read_structure_guide with topic "${first.guide}" explains it.`,
    { diagrams: refused.map((refusal) => ({ position: refusal.position, ...(refusal.title ? { title: refusal.title } : {}), issues: refusal.issues, guide: refusal.guide })) },
  );
}

/** What the model must correct about pictures and Mermaid fences, in one refusal. */
function refusePictures(refusals: PictureRefusal[]): never {
  const lines = refusals.map((refusal) => (refusal.kind === "mermaid" ? `Mermaid diagram ${refusal.position}: ${refusal.reason}` : `picture ${refusal.position}: ${refusal.reason}`));
  // Said to the model, not the user: Codestral relayed "give the picture as a data: URI"
  // to a user who had only given a web address, and wrote nothing.
  const unfetched = refusals.some((refusal) => refusal.kind === "picture" && refusal.reason.includes("are not fetched"));
  throw new OfficeRefusal(
    `Nothing was written. This message is for you, not for the user: correct these and call again now, in this same reply: ${lines.join("; ")}.` +
      (unfetched
        ? " For a picture given as a web address: remove its ![…](…) line and call create_document again now, then tell the user the document leaves that picture out because pictures cannot be fetched from a web address. Do not ask the user for anything."
        : ""),
    {
    pictures: refusals.filter((refusal) => refusal.kind === "picture").map(({ position, reason }) => ({ position, reason })),
    mermaid: refusals.filter((refusal) => refusal.kind === "mermaid").map(({ position, reason }) => ({ position, reason })),
  });
}

function checkSize(bytes: Buffer, settings: OfficeSettings): void {
  if (bytes.length > settings.maxFileBytes) {
    throw new OfficeRefusal(`the file would be ${bytes.length} bytes, over this server's limit of ${settings.maxFileBytes}: make it smaller (fewer or smaller pictures) or split it`, {
      size: bytes.length,
      limit: settings.maxFileBytes,
    });
  }
}

/* ── Word ───────────────────────────────────────────────────────────────────── */

const FIGURE_SCHEME = "sx-figure:";

/** The headings of the Markdown, in order: the document's outline. */
function headingsOf(markdown: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  const textOf = (node: { type: string; value?: string; children?: unknown[] }): string =>
    node.value ?? ((node.children ?? []) as { type: string; value?: string; children?: unknown[] }[]).map(textOf).join("");
  for (const node of parseMarkdown(markdown).children as { type: string; depth?: number; children?: unknown[] }[]) {
    if (node.type === "heading") headings.push({ level: node.depth ?? 1, text: textOf(node).trim() });
  }
  return headings;
}

/** Notes that report something already done, not something missing: they do not refuse a call. */
function blocking(warnings: string[]): string[] {
  return warnings.filter((warning) => !warning.startsWith("the typed number was removed"));
}

interface DrawnFences {
  markdown: string;
  vectors: Map<string, DiagramImage>;
  figures: string[];
  refused: DiagramRefusal[];
}

/**
 * The Markdown with each structured-exchange fence drawn in place: a figure becomes a
 * picture reference the picture source answers, a table its Markdown. Diagrams are
 * numbered from `first`, so several pieces of one call number them in one sequence.
 */
function drawFences(source: string, font: string, first = 1): DrawnFences {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const vectors = new Map<string, DiagramImage>();
  const refused: DiagramRefusal[] = [];
  const figures: string[] = [];
  const blocks = structuredExchangeBlockRanges(source);
  for (const [index, block] of [...blocks.entries()].reverse()) {
    const position = first + index;
    const drawn = drawStructure(block.content, position, font);
    if (!("kind" in drawn)) {
      refused.unshift(drawn);
      continue;
    }
    let replacement: string;
    if (drawn.kind === "table") {
      replacement = (drawn.title ? `**${drawn.title}**\n\n` : "") + drawn.markdown.trimEnd();
    } else {
      const key = `${FIGURE_SCHEME}${position}`;
      vectors.set(key, drawn.image);
      replacement = `![${(drawn.title ?? `Diagram ${position}`).replace(/[[\]\\]/g, "")}](${key})`;
    }
    figures.unshift(drawn.title ?? `Diagram ${position}`);
    lines.splice(block.firstLine, block.lastLine - block.firstLine + 1, replacement);
  }
  return { markdown: lines.join("\n"), vectors, figures, refused };
}

function mermaidFigures(markdown: string, first = 1): string[] {
  const count = (markdown.match(/^ {0,3}(`{3,}|~{3,})\s*mermaid\b/gim) ?? []).length;
  return Array.from({ length: count }, (_, index) => `Mermaid diagram ${first + index}`);
}

export async function writeWordDocument(settings: OfficeSettings, body: { file_name?: unknown; markdown?: unknown; template?: unknown; keep?: unknown }): Promise<WrittenFile> {
  const fileName = downloadName(body.file_name, ".docx");
  if (typeof body.markdown !== "string" || body.markdown.trim() === "") throw new OfficeRefusal("markdown is required: the document's content, in Markdown");
  const keep = body.keep ?? [];
  if (!Array.isArray(keep) || keep.some((part) => part !== "cover" && part !== "toc")) throw new OfficeRefusal('keep, when given, lists "cover" and/or "toc"');
  const font = settings.font ?? DEFAULT_MERMAID_FONT;

  const chosen = await templateBytes(settings, body.template, "word");
  let template: WordPackage;
  try {
    template = readWordPackage(chosen?.bytes ?? defaultWordTemplateBytes(), chosen ? `"${chosen.name}"` : "the built-in template");
  } catch (error) {
    if (error instanceof WordTemplateError) throw new OfficeRefusal(error.message);
    throw error;
  }

  const drawn = drawFences(body.markdown, font);
  if (drawn.refused.length > 0) refuseDiagrams(drawn.refused);
  const pictures = callPictures({ mermaid: settings.mermaid, maxImageBytes: settings.maxImageBytes, vectors: drawn.vectors });
  let created;
  try {
    created = await createDocument(template, drawn.markdown, { keep: keep as KeepPart[], pictures: pictures.source });
  } catch (error) {
    if (error instanceof WordTemplateError) throw new OfficeRefusal(error.message);
    throw error;
  }
  const refusals = pictures.refusals();
  if (refusals.length > 0) refusePictures(refusals);
  // A requested cover page or table of contents the template does not have is what
  // is left in the warnings: the model asked for it, so it is told.
  const warnings = blocking(created.warnings);
  if (warnings.length > 0) throw new OfficeRefusal(`Nothing was written: ${warnings.join("; ")}`);
  checkSize(created.bytes, settings);
  return {
    fileName,
    mediaType: WORD_MEDIA_TYPE,
    bytes: created.bytes,
    outline: headingsOf(drawn.markdown),
    figures: [...drawn.figures, ...mermaidFigures(drawn.markdown)],
    template: chosen?.name ?? DEFAULT_WORD_TEMPLATE_NAME,
  };
}

const SECTION_ACTIONS = ["replace", "insert_after", "append", "delete"] as const;

/**
 * A Word document written earlier, changed section by section with pi-outpost's
 * `docx_update`: a section is named by its heading path, and the rest of the document is
 * kept as it is. Diagrams and pictures in the new content are drawn as at creation.
 */
export async function updateWordFile(settings: OfficeSettings, stored: { bytes: Buffer; meta: { fileName: string; template: string } }, body: { edits?: unknown }): Promise<WrittenFile> {
  if (!Array.isArray(body.edits) || body.edits.length === 0) throw new OfficeRefusal("edits is required: the changes to make, in order");
  const font = settings.font ?? DEFAULT_MERMAID_FONT;
  const edits: DocxEdit[] = [];
  const refused: DiagramRefusal[] = [];
  const problems: string[] = [];
  const figures: string[] = [];
  const pictureSources: ReturnType<typeof callPictures>[] = [];
  let nextDiagram = 1;
  let nextMermaid = 1;
  for (const [index, raw] of (body.edits as unknown[]).entries()) {
    const label = `edit ${index + 1}`;
    const edit = (raw ?? {}) as { action?: unknown; section?: unknown; markdown?: unknown };
    if (typeof edit.action !== "string" || !(SECTION_ACTIONS as readonly string[]).includes(edit.action)) {
      problems.push(`${label}: action is one of ${SECTION_ACTIONS.join(", ")}`);
      continue;
    }
    if (edit.action !== "append" && (typeof edit.section !== "string" || edit.section.trim() === "")) {
      problems.push(`${label}: section names the heading to ${edit.action === "delete" ? "delete" : edit.action === "replace" ? "replace the content of" : "insert after"}, as list_documents shows it`);
      continue;
    }
    if (edit.action === "delete") {
      edits.push({ action: "delete", section: edit.section as string });
      continue;
    }
    if (typeof edit.markdown !== "string" || edit.markdown.trim() === "") {
      problems.push(`${label}: markdown is the new content`);
      continue;
    }
    const drawn = drawFences(edit.markdown, font, nextDiagram);
    nextDiagram += structuredExchangeBlockRanges(edit.markdown).length;
    refused.push(...drawn.refused);
    figures.push(...drawn.figures, ...mermaidFigures(drawn.markdown, nextMermaid));
    nextMermaid += mermaidFigures(drawn.markdown).length;
    const pictures = callPictures({ mermaid: settings.mermaid, maxImageBytes: settings.maxImageBytes, vectors: drawn.vectors });
    pictureSources.push(pictures);
    edits.push(
      edit.action === "append"
        ? { action: "append", markdown: drawn.markdown, pictures: pictures.source }
        : { action: edit.action as "replace" | "insert_after", section: edit.section as string, markdown: drawn.markdown, pictures: pictures.source },
    );
  }
  if (refused.length > 0) refuseDiagrams(refused);
  if (problems.length > 0) throw new OfficeRefusal(`Nothing was changed. Correct these and call again: ${problems.join("; ")}`);

  let updated;
  try {
    // Written straight in, not as tracked changes: these are the model's own drafts.
    updated = await updateDocument(readWordPackage(stored.bytes, `"${stored.meta.fileName}"`), edits, { trackChanges: false });
  } catch (error) {
    if (error instanceof WordTemplateError) throw new OfficeRefusal(`Nothing was changed: ${error.message}`);
    throw error;
  }
  const refusals = pictureSources.flatMap((pictures) => pictures.refusals());
  if (refusals.length > 0) refusePictures(refusals);
  const warnings = blocking(updated.warnings);
  if (warnings.length > 0) throw new OfficeRefusal(`Nothing was changed: ${warnings.join("; ")}`);
  checkSize(updated.bytes, settings);
  return { fileName: stored.meta.fileName, mediaType: WORD_MEDIA_TYPE, bytes: updated.bytes, outline: outlineOf(WORD_MEDIA_TYPE, updated.bytes), figures, template: stored.meta.template };
}

/* ── PowerPoint ─────────────────────────────────────────────────────────────── */

const MAX_SLIDE_PARAMETERS = 200;

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** A diagram for a slide: its SVG as the slide's picture, the PNG drawn behind it by the builder. */
function svgPicture(image: DiagramImage, name: string, alt?: string): SlideImage {
  const bytes = Buffer.from(image.svg, "utf8");
  return { name, bytes, info: { kind: "svg", width: image.width, height: image.height }, ...(alt ? { alt } : {}) };
}

interface SlideParsing {
  font: string;
  refused: DiagramRefusal[];
  problems: string[];
  figures: string[];
  diagrams: number;
}

/** One slide as the model gave it, as the builder takes it; what is wrong goes into `parsing`. */
async function slideSpec(settings: OfficeSettings, raw: unknown, label: string, parsing: SlideParsing): Promise<SlideSpec | undefined> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    parsing.problems.push(`${label} is not an object`);
    return undefined;
  }
  const slide = raw as Record<string, unknown>;
  const spec: SlideSpec = {};
  for (const field of ["layout", "title", "subtitle"] as const) {
    const value = slide[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") parsing.problems.push(`${label}: ${field} is text`);
    else spec[field] = value;
  }
  if (slide.bullets !== undefined && slide.bullets !== null) {
    if (stringArray(slide.bullets)) spec.bullets = slide.bullets;
    else parsing.problems.push(`${label}: bullets is a list of texts`);
  }
  if (slide.table !== undefined && slide.table !== null) {
    const table = slide.table as { rows?: unknown; header?: unknown };
    if (!Array.isArray(table.rows) || !table.rows.every(stringArray)) parsing.problems.push(`${label}: table.rows is a list of rows, each a list of texts`);
    else spec.table = { rows: table.rows as string[][], ...(typeof table.header === "boolean" ? { header: table.header } : {}) };
  }
  if (slide.chart !== undefined && slide.chart !== null) {
    const chart = slide.chart as Record<string, unknown>;
    spec.chart = {
      type: chart.type as never,
      categories: chart.categories as string[],
      series: chart.series as { name: string; values: number[] }[],
      ...(typeof chart.title === "string" ? { title: chart.title } : {}),
      ...(typeof chart.stacked === "boolean" ? { stacked: chart.stacked } : {}),
      ...(typeof chart.number_format === "string" ? { numberFormat: chart.number_format } : {}),
      ...(typeof chart.show_values === "boolean" ? { showValues: chart.show_values } : {}),
    };
  }
  if (slide.diagram !== undefined && slide.diagram !== null) {
    const position = ++parsing.diagrams;
    const drawn = drawStructure(slide.diagram, position, parsing.font);
    if (!("kind" in drawn)) parsing.refused.push(drawn);
    else if (drawn.kind === "table") {
      // A table document becomes the slide's native table: its columns, then its rows.
      spec.table = { rows: drawn.rows };
      parsing.figures.push(drawn.title ?? `Table on ${label}`);
    } else {
      spec.image = svgPicture(drawn.image, `diagram ${position}`, drawn.title);
      parsing.figures.push(drawn.title ?? `Diagram on ${label}`);
    }
  }
  if (slide.mermaid !== undefined && slide.mermaid !== null) {
    if (typeof slide.mermaid !== "string") parsing.problems.push(`${label}: mermaid is the diagram's Mermaid source, as text`);
    else {
      try {
        spec.image = svgPicture(await settings.mermaid.render(slide.mermaid), `${label} Mermaid diagram`);
        parsing.figures.push(`Mermaid diagram on ${label}`);
      } catch (error) {
        if (!(error instanceof MermaidError)) throw error;
        parsing.problems.push(`${label}: Mermaid could not draw the diagram: ${error.message}`);
      }
    }
  }
  if (slide.image !== undefined && slide.image !== null) {
    const image = slide.image as { data?: unknown; alt?: unknown };
    const picture = typeof image.data === "string" ? readPictureDataUri(image.data, settings.maxImageBytes) : "image.data is the picture as a data: URI";
    if (typeof picture === "string") parsing.problems.push(`${label}: picture: ${picture}`);
    else spec.image = { name: `${label} picture`, bytes: picture.bytes, info: picture.info, ...(typeof image.alt === "string" ? { alt: image.alt } : {}) };
  }
  const visuals = ["table", "chart", "diagram", "mermaid", "image"].filter((field) => slide[field] !== undefined && slide[field] !== null);
  if (visuals.length > 1) parsing.problems.push(`${label}: a slide holds one of table, chart, diagram, mermaid and image, not ${visuals.join(" and ")}: put the others on slides of their own`);
  return spec;
}

function slideRasterizer(font: string) {
  return {
    rasterizeSvg: async (svg: Buffer) => {
      try {
        return Buffer.from(rasterizeSvg(svg.toString("utf8"), font));
      } catch (error) {
        if (error instanceof RasterError) return null;
        throw error;
      }
    },
  };
}

export async function writePresentation(settings: OfficeSettings, body: { file_name?: unknown; slides?: unknown; template?: unknown }): Promise<WrittenFile> {
  const fileName = downloadName(body.file_name, ".pptx");
  if (!Array.isArray(body.slides) || body.slides.length === 0) throw new OfficeRefusal("slides is required: the deck's slides, in order");
  if (body.slides.length > MAX_SLIDE_PARAMETERS) throw new OfficeRefusal(`at most ${MAX_SLIDE_PARAMETERS} slides`);
  const font = settings.font ?? DEFAULT_MERMAID_FONT;

  const chosen = await templateBytes(settings, body.template, "powerpoint");
  let template;
  try {
    template = readTemplate(chosen?.bytes ?? defaultTemplateBytes());
  } catch (error) {
    if (error instanceof PptxBuildError) throw new OfficeRefusal(error.message);
    throw error;
  }

  const parsing: SlideParsing = { font, refused: [], problems: [], figures: [], diagrams: 0 };
  const specs: SlideSpec[] = [];
  for (const [index, raw] of (body.slides as unknown[]).entries()) {
    const spec = await slideSpec(settings, raw, `slide ${index + 1}`, parsing);
    if (spec !== undefined) specs.push(spec);
  }
  if (parsing.refused.length > 0) refuseDiagrams(parsing.refused);
  if (parsing.problems.length > 0) throw new OfficeRefusal(`Nothing was written. Correct these and call again: ${parsing.problems.join("; ")}`);

  let built;
  try {
    built = await buildPresentation(template, specs, slideRasterizer(font));
  } catch (error) {
    if (error instanceof PptxBuildError) throw new OfficeRefusal(`Nothing was written: ${error.message}`);
    throw error;
  }
  const warnings = built.slides.flatMap((slide) => slide.warnings.map((warning) => `slide ${slide.number}: ${warning}`));
  if (warnings.length > 0) throw new OfficeRefusal(`Nothing was written: ${warnings.join("; ")}`);
  checkSize(built.bytes, settings);
  return {
    fileName,
    mediaType: POWERPOINT_MEDIA_TYPE,
    bytes: built.bytes,
    outline: specs.map((spec, index) => ({ level: 1, text: spec.title ?? `Slide ${index + 1}` })),
    figures: parsing.figures,
    template: chosen?.name ?? DEFAULT_TEMPLATE_NAME,
  };
}

const SLIDE_ACTIONS = ["replace", "insert_after", "delete", "move"] as const;

/** A slide named by its number (as a number or in digits) or its title, as list_documents shows them. */
function slideRef(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) return Number(value);
  if (typeof value === "string" && value.trim() !== "") return value;
  return undefined;
}

/**
 * A deck written earlier, changed slide by slide with pi-outpost's `pptx_update`: the
 * slides not named are kept as they are. A new or replaced slide is given as at creation.
 */
export async function updatePresentationFile(settings: OfficeSettings, stored: { bytes: Buffer; meta: { fileName: string; template: string } }, body: { edits?: unknown }): Promise<WrittenFile> {
  if (!Array.isArray(body.edits) || body.edits.length === 0) throw new OfficeRefusal("edits is required: the changes to make, in order");
  const font = settings.font ?? DEFAULT_MERMAID_FONT;
  const parsing: SlideParsing = { font, refused: [], problems: [], figures: [], diagrams: 0 };
  const edits: DeckEdit[] = [];
  for (const [index, raw] of (body.edits as unknown[]).entries()) {
    const label = `edit ${index + 1}`;
    const edit = (raw ?? {}) as { action?: unknown; slide?: unknown; after?: unknown; content?: unknown };
    if (typeof edit.action !== "string" || !(SLIDE_ACTIONS as readonly string[]).includes(edit.action)) {
      parsing.problems.push(`${label}: action is one of ${SLIDE_ACTIONS.join(", ")}`);
      continue;
    }
    const named = slideRef(edit.slide);
    const slide = edit.action === "insert_after" && named === 0 ? 0 : named === 0 ? undefined : named;
    if (slide === undefined) {
      parsing.problems.push(`${label}: slide is the slide's number or title${edit.action === "insert_after" ? " (0 to insert first)" : ""}, as list_documents shows them`);
      continue;
    }
    if (edit.action === "delete") {
      edits.push({ action: "delete", slide: slide as number | string });
      continue;
    }
    if (edit.action === "move") {
      const after = slideRef(edit.after);
      if (after === undefined) parsing.problems.push(`${label}: after is the slide to move it after, by number or title, or 0 to move it first`);
      else edits.push({ action: "move", slide: slide as number | string, after });
      continue;
    }
    const content = await slideSpec(settings, edit.content, `${label} content`, parsing);
    if (content === undefined) continue;
    edits.push(edit.action === "replace" ? { action: "replace", slide: slide as number | string, content } : { action: "insert_after", slide, content });
  }
  if (parsing.refused.length > 0) refuseDiagrams(parsing.refused);
  if (parsing.problems.length > 0) throw new OfficeRefusal(`Nothing was changed. Correct these and call again: ${parsing.problems.join("; ")}`);

  let updated;
  try {
    updated = await updatePresentation(stored.bytes, edits, slideRasterizer(font));
  } catch (error) {
    if (error instanceof PptxBuildError) throw new OfficeRefusal(`Nothing was changed: ${error.message}`);
    throw error;
  }
  if (updated.warnings.length > 0) throw new OfficeRefusal(`Nothing was changed: ${updated.warnings.join("; ")}`);
  checkSize(updated.bytes, settings);
  return { fileName: stored.meta.fileName, mediaType: POWERPOINT_MEDIA_TYPE, bytes: updated.bytes, outline: outlineOf(POWERPOINT_MEDIA_TYPE, updated.bytes), figures: parsing.figures, template: stored.meta.template };
}

/* ── What a kept file holds ─────────────────────────────────────────────────── */

/** A file's outline: a Word document's headings, a deck's slide titles. */
export function outlineOf(mediaType: string, bytes: Buffer): { level: number; text: string }[] {
  try {
    if (mediaType === POWERPOINT_MEDIA_TYPE) return slideTitles(bytes).map((title, index) => ({ level: 1, text: title === "" ? `Slide ${index + 1}` : title }));
    return documentHeadings(readWordPackage(bytes, "the document"));
  } catch {
    return [];
  }
}
