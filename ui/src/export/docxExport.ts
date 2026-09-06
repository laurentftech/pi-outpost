/**
 * A document, taken away as Word.
 *
 * The table export next door answers the same need for one kind of content: a
 * reader who wants to keep a table wants it in a spreadsheet. A reader who wants
 * to keep a *document* wants it in Word — with its headings still headings and its
 * tables still tables, not as Markdown punctuation someone has to clean up by hand.
 *
 * Nothing here is reached from the main bundle. `FileViewer` imports this module
 * with `import()` inside its click handler, so a session that never exports never
 * downloads a document writer. Everything heavy — the OOXML writer, KaTeX, mermaid —
 * hangs off this entry and travels in its chunk.
 */
import { AlignmentType, Document, LevelFormat, Packer } from "docx";
import { save } from "../util/download";
import { markdownToDocx, ORDERED_NUMBERING, type DocxBlock } from "./markdownToDocx";
import { plainTextToDocx } from "./plainTextToDocx";

/**
 * What the download is called.
 *
 * The source's own extension is replaced rather than appended: `report.md` becomes
 * `report.docx`, not `report.md.docx`. Only a final extension counts as one, so a
 * name that merely contains dots keeps them, and a name with no extension gains
 * one instead of losing its last word.
 */
export function docxFileName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "document";
  // A leading dot is a dotfile's name, not an extension: `.gitignore` is not an
  // empty name with a `gitignore` extension, and must not export as `.docx`.
  const cut = base.lastIndexOf(".");
  const stem = cut > 0 ? base.slice(0, cut) : base;
  return `${stem}.docx`;
}

/** Whether the document should be read as Markdown — the viewer's own test. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * The document as a Word package.
 *
 * Separated from the download so tests can read the bytes: what this produces is
 * a zip of XML parts, and the only honest way to check it is to open it up. The
 * writer is imported here rather than at the top of the module for the reason
 * given above — though within this module that is a formality, since the module
 * itself is only ever reached by `import()`.
 */
export async function buildDocx(text: string, path: string): Promise<Blob> {
  const document = new Document({
    numbering: { config: [orderedNumbering()] },
    sections: [{ children: await documentChildren(text, path) }],
  });
  return Packer.toBlob(document);
}

/**
 * The definition ordered lists draw their markers from.
 *
 * Word does not number a paragraph because it looks like a list item; it numbers
 * one that points at a numbering definition. Five levels, cycling through the
 * markers Word's own default list uses, each indented one step further than the
 * last so nesting reads as nesting.
 */
function orderedNumbering() {
  const FORMATS = [
    LevelFormat.DECIMAL,
    LevelFormat.LOWER_LETTER,
    LevelFormat.LOWER_ROMAN,
    LevelFormat.DECIMAL,
    LevelFormat.LOWER_LETTER,
  ] as const;
  return {
    reference: ORDERED_NUMBERING,
    levels: FORMATS.map((format, level) => ({
      level,
      format,
      text: `%${level + 1}.`,
      alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    })),
  };
}

/**
 * The body of the document.
 *
 * Markdown goes through the mapping; anything else is lines of monospace text.
 * Which of the two is decided by the file's name and nothing else — a `.log` that
 * happens to open with `# ` is a log, not a document with a heading.
 */
async function documentChildren(text: string, path: string): Promise<DocxBlock[]> {
  return isMarkdownPath(path) ? markdownToDocx(text) : plainTextToDocx(text);
}

/** Builds the document and hands it to the browser. */
export async function downloadDocx(text: string, path: string): Promise<void> {
  save(await buildDocx(text, path), docxFileName(path));
}
