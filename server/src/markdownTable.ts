/**
 * Cell escaping for the markdown tables the document readers produce.
 *
 * Shared rather than copied: the PDF reader owned this alone until Word
 * extraction needed the same rule, and an escaper that exists twice is one that
 * gets fixed once. This one came out of a CodeQL finding
 * (`js/incomplete-sanitization`) — escaping the pipe but not the backslash left
 * `\|` as `\\|`, an escaped backslash followed by a live separator, so a crafted
 * cell could close its own column and shift every column after it.
 */

/**
 * A cell's text, safe to place between pipes.
 *
 * Backslashes go first. Escaping them after the pipes would re-escape the
 * escapes this function just added, which is the same bug wearing a different
 * hat. Whitespace collapses because a newline inside a cell ends the row.
 */
export function escapeCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/**
 * A GFM table from rows of already-escaped-or-not cells.
 *
 * Every row is padded to the same width: a table whose rows disagree about how
 * many columns they have is not a table any renderer will draw the same way
 * twice.
 */
export function renderMarkdownTable(rows: string[][], options: { header: boolean }): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => {
    const cells = row.map(escapeCell);
    while (cells.length < width) cells.push("");
    return `| ${cells.join(" | ")} |`;
  };

  const separator = `| ${new Array(width).fill("---").join(" | ")} |`;
  if (options.header) {
    return [pad(rows[0]), separator, ...rows.slice(1).map(pad)].join("\n");
  }
  // GFM has no headerless form; an empty header row is honest about the document
  // not having declared one, where promoting the first row would invent it.
  return [`| ${new Array(width).fill("").join(" | ")} |`, separator, ...rows.map(pad)].join("\n");
}
