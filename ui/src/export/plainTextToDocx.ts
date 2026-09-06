/**
 * A text file, as a document someone can send on.
 *
 * A `.log`, a `.ts` or a `.txt` is not Markdown and must not be read as any: a log
 * line beginning `# ` is a comment, not a heading, and a stack trace full of `$`
 * and `|` is not equations and tables. The guarantee is kept by never running the
 * Markdown pipeline over it rather than by escaping afterwards — there is nothing
 * to escape if nothing is ever interpreted.
 */
import { Paragraph, TextRun } from "docx";
import { xmlSafe } from "./xmlText";

/** The face code is set in, matching the one the Markdown mapping uses. */
const MONOSPACE = "Consolas, Courier New, monospace";

/**
 * One paragraph per line.
 *
 * Per line rather than one paragraph with breaks, so a long file can break across
 * pages: Word keeps a paragraph together, and a thousand-line log in one paragraph
 * is a page with 990 lines missing off the bottom.
 *
 * A blank line still gets a run holding a space, because an empty paragraph
 * collapses and the gaps in a file are part of reading it.
 */
export function plainTextToDocx(text: string): Paragraph[] {
  // Both line endings, and a trailing newline does not invent a final empty line.
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: xmlSafe(line === "" ? " " : line), font: MONOSPACE })],
        spacing: { before: 0, after: 0 },
      }),
  );
}
