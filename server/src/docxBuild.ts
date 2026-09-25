/**
 * `docx_create`: a Word document written from Markdown into a template.
 *
 * The template's own body is sample text and goes; its cover page and table of
 * contents stay in front of the content when asked for. Its final section settings —
 * page size, margins, headers, footers — end the new body, which is what makes them
 * the document's. The content itself is carried in by `WordComposer`.
 */
import type { PictureSource, ReferencedImage } from "@pi-outpost/shared/docx";
import { countDiagrams } from "@pi-outpost/shared/docx";
import { generateContent, WordComposer, type GeneratedContent } from "./docxGraft.ts";
import { isGallery, isTableOfContents, WordTemplateError, type WordPackage } from "./docxTemplate.ts";
import { bodyLayout } from "./wordml.ts";

export const MAX_MARKDOWN_CHARS = 2_000_000;

export type KeepPart = "cover" | "toc";

export interface CreateOptions {
  keep?: KeepPart[];
  pictures?: PictureSource;
}

export interface CreatedDocument {
  bytes: Buffer;
  warnings: string[];
}

/** A picture source that remembers which references it could not load. */
export function countingPictures(source: PictureSource): { source: PictureSource; missed: string[] } {
  const missed: string[] = [];
  return {
    missed,
    source: {
      ...source,
      loadImage:
        source.loadImage === undefined
          ? undefined
          : async (src: string): Promise<ReferencedImage | undefined> => {
              const loaded = await source.loadImage!(src);
              if (loaded === undefined) missed.push(src);
              return loaded;
            },
    },
  };
}

/** What the content could not carry, for the tool's answer. */
export function contentWarnings(markdown: string, pictures: PictureSource, missed: string[]): string[] {
  const warnings: string[] = [];
  const diagrams = pictures.renderDiagram === undefined ? countDiagrams(markdown) : 0;
  if (diagrams > 0) warnings.push(`${diagrams} mermaid diagram(s) written as their source, as code: diagrams are drawn only by the viewer's export`);
  for (const src of [...new Set(missed)]) warnings.push(`picture "${src}" could not be loaded; its alt text was written instead`);
  return warnings;
}

export async function createDocument(template: WordPackage, markdown: string, options: CreateOptions = {}): Promise<CreatedDocument> {
  if (markdown.trim() === "") throw new WordTemplateError("there is no content to write");
  if (markdown.length > MAX_MARKDOWN_CHARS) throw new WordTemplateError(`the content is longer than ${MAX_MARKDOWN_CHARS} characters`);
  const counting = countingPictures(options.pictures ?? {});
  const generated = await generateContent(markdown, counting.source);
  return createFromContent(template, generated, options.keep ?? [], contentWarnings(markdown, counting.source, counting.missed));
}

/**
 * A document from content already written as Word — by `generateContent`, or by the
 * viewer's export in the browser — carried into the template.
 */
export function createFromContent(template: WordPackage, generated: GeneratedContent, keepParts: KeepPart[], contentNotes: string[] = []): CreatedDocument {
  const keep = new Set(keepParts);
  const warnings: string[] = [];
  const layout = bodyLayout(template.documentXml);
  const kept: string[] = [];
  const cover = layout.children.find((child) => child.local === "sdt" && isGallery(child.xml, "Cover Pages"));
  const toc = layout.children.find((child) => (child.local === "sdt" || child.local === "p") && child !== cover && isTableOfContents(child.xml));
  if (keep.has("cover")) {
    if (cover === undefined) warnings.push("the template has no cover page to keep");
    else kept.push(cover.xml);
  }
  if (keep.has("toc")) {
    if (toc === undefined) warnings.push("the template has no table of contents to keep");
    else kept.push(toc.xml);
  }

  const composer = new WordComposer(template);
  const content = composer.adopt(generated);
  warnings.push(...contentNotes);

  const body = [...kept, ...content, layout.sectPr?.xml ?? ""].join("");
  const documentXml = template.documentXml.slice(0, layout.innerStart) + body + template.documentXml.slice(layout.innerEnd);
  const bytes = composer.compose(documentXml, { asDocument: true, updateFields: keep.has("toc") && toc !== undefined, sweep: "all" });
  return { bytes, warnings };
}
