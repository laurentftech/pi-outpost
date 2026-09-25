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
import { Packer } from "docx";
import { docxDocument } from "@pi-outpost/shared/docx";
import { save } from "../util/download";
import { markdownToDocx, type DocxBlock } from "./markdownToDocx";
import { plainTextToDocx } from "./plainTextToDocx";

/**
 * What the export needs beyond the text: where to reach the workspace files the
 * document references. Both are absent when nothing is referenced, and `""` with
 * a `null` token is the standalone, same-origin case.
 */
export type ExportOptions = { serverUrl?: string; token?: string | null };

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
export async function buildDocx(text: string, path: string, options?: ExportOptions): Promise<Blob> {
  return Packer.toBlob(docxDocument(await documentChildren(text, path, options)));
}

/**
 * The body of the document.
 *
 * Markdown goes through the mapping; anything else is lines of monospace text.
 * Which of the two is decided by the file's name and nothing else — a `.log` that
 * happens to open with `# ` is a log, not a document with a heading.
 */
async function documentChildren(text: string, path: string, options?: ExportOptions): Promise<DocxBlock[]> {
  // The document's own path travels with it: a reference in it resolves against
  // the directory it lives in, exactly as the viewer resolves one on screen.
  return isMarkdownPath(path) ? markdownToDocx(text, { ...options, path }) : plainTextToDocx(text);
}

/** Builds the document and hands it to the browser. */
export async function downloadDocx(text: string, path: string, options?: ExportOptions): Promise<void> {
  save(await buildDocx(text, path, options), docxFileName(path));
}

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The same document, written into the server's configured Word template.
 *
 * Built here exactly as the plain export is — the diagrams and pictures are the
 * browser's to draw and fetch — then sent to the server, which carries its body into
 * the template (its styles, numbering, page setup, header and footer) and answers
 * with the result. The template is the server's configuration, never the page's.
 */
export async function buildDocxInTemplate(text: string, path: string, options?: ExportOptions): Promise<Blob> {
  const document = await buildDocx(text, path, options);
  const headers: Record<string, string> = { "Content-Type": DOCX_TYPE };
  if (options?.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${options?.serverUrl ?? ""}/files/docx-template`, { method: "POST", headers, body: document });
  if (!response.ok) {
    const answer = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(answer?.message ?? `the server answered ${response.status}`);
  }
  return response.blob();
}

/** Builds the document in the template and hands it to the browser. */
export async function downloadDocxInTemplate(text: string, path: string, options?: ExportOptions): Promise<void> {
  save(await buildDocxInTemplate(text, path, options), docxFileName(path));
}
