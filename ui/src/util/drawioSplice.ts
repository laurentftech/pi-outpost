/**
 * Putting one touched-up page back into a `.drawio` file.
 *
 * The frame hands back the page it shows as a whole `<mxGraphModel>`, its own attributes
 * restored (see `drawioPage`). Everything else in the file is the reader's or the agent's,
 * so it is spliced into the text rather than round-tripped through a DOM serializer: the
 * other pages stay byte for byte as they were, compressed or not, with their comments and
 * their layout. The touched-up page is written plain, even when it was compressed: draw.io
 * reads both, and a compressed page is one the agent cannot edit.
 */

export class DrawioSpliceError extends Error {}

/** `<diagram …>…</diagram>` and `<diagram …/>` elements, in order, by their offsets. */
function diagramRanges(text: string): { start: number; end: number; innerStart: number; innerEnd: number }[] {
  const ranges: { start: number; end: number; innerStart: number; innerEnd: number }[] = [];
  const open = /<diagram(?=[\s/>])[^>]*?(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(text)) !== null) {
    const start = match.index;
    const innerStart = start + match[0].length;
    if (match[1] === "/") {
      ranges.push({ start, end: innerStart, innerStart, innerEnd: innerStart });
      continue;
    }
    const close = text.indexOf("</diagram>", innerStart);
    if (close === -1) throw new DrawioSpliceError("a <diagram> element is not closed");
    ranges.push({ start, end: close + "</diagram>".length, innerStart, innerEnd: close });
    open.lastIndex = close + "</diagram>".length;
  }
  return ranges;
}

/** The whitespace a line starts with, at `offset`. */
function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, offset))![0];
}

/** `model`, each line indented by `indent`. */
function indented(model: string, indent: string): string {
  return model
    .trim()
    .split(/\r?\n/)
    .map((line) => indent + line)
    .join("\n");
}

/**
 * `fileText` with page `pageIndex` holding `modelXml` (an `<mxGraphModel>` element).
 * A file that is a bare `<mxGraphModel>` has one page, and it is replaced whole.
 */
export function spliceDrawioPage(fileText: string, pageIndex: number, modelXml: string): string {
  if (!/^\s*<mxGraphModel[\s>]/.test(modelXml)) throw new DrawioSpliceError("the page to save is not an <mxGraphModel>");
  const newline = fileText.includes("\r\n") ? "\r\n" : "\n";
  const ranges = diagramRanges(fileText);
  if (ranges.length === 0) {
    const start = fileText.search(/<mxGraphModel[\s>]/);
    const close = fileText.lastIndexOf("</mxGraphModel>");
    if (start === -1 || close === -1 || pageIndex !== 0) throw new DrawioSpliceError("the file has no page to put this one in");
    const end = close + "</mxGraphModel>".length;
    return fileText.slice(0, start) + indented(modelXml, indentAt(fileText, start)).trimStart().split("\n").join(newline) + fileText.slice(end);
  }
  const page = ranges[pageIndex];
  if (page === undefined) throw new DrawioSpliceError(`the file has no page ${pageIndex + 1}`);
  const outer = indentAt(fileText, page.start);
  const inner = indented(modelXml, outer + "  ").split("\n").join(newline);
  // A self-closed <diagram/> gets a body: rewrite its opening tag as an open one
  const openTag = fileText.slice(page.start, page.innerStart).replace(/\s*\/>$/, ">");
  return fileText.slice(0, page.start) + openTag + newline + inner + newline + outer + "</diagram>" + fileText.slice(page.end);
}
