/**
 * Which document extractors a piece of conversation calls for.
 *
 * The four extractor schemas come to some 8 000 characters — around a quarter of a
 * session's whole prompt floor — describing how to read Word, Excel, PowerPoint and
 * PDF to conversations that overwhelmingly never open one. They are published when a
 * document of their kind enters the conversation instead, and this is the reading of
 * "enters".
 *
 * It is a *text* test, not a filesystem one. The file may not exist yet, may sit
 * outside the sandbox, may be a path the user mistyped: none of that changes the
 * answer, because what is being decided is whether describing the tool is worth its
 * place in every subsequent request. A wrong guess publishes a tool that goes unused,
 * which is exactly where every session starts today.
 */

/** Extension → the tool that reads it. */
const EXTRACTORS: Record<string, string> = {
  pdf: "pdf_extract",
  docx: "docx_extract",
  xlsx: "xlsx_extract",
  pptx: "pptx_extract",
};

export const DOCUMENT_TOOLS = Object.values(EXTRACTORS);

/**
 * A path-like token ending in one of the four extensions.
 *
 * The boundary before the name is what keeps prose out: "convert this to PDF" names no
 * file, and publishing on the bare word would put all four back in every conversation
 * that merely discusses documents.
 *
 * Inside the name, almost anything goes — parentheses and brackets included, because
 * `report (1).pdf` is what a browser calls the second copy of a download and
 * `report[final].docx` is what a colleague sends. An earlier version excluded them and
 * silently failed on exactly the files people attach most.
 *
 * What still ends a name: whitespace, quotes and angle brackets, followed by the
 * extension and then end-of-token — whitespace, closing punctuation (a bracket that
 * closed a parenthetical, "(report.pdf)", as much as a comma), or a sentence's full
 * stop.
 */
const MENTION = /(?:^|[\s"'`<])(?:[^\s"'`<>]*[/\\])?[^\s"'`<>/\\]+\.(pdf|docx|xlsx|pptx)(?=$|[\s"'`>)\],;:!?.])/gi;

/**
 * The extractor tools the text calls for, in the order they are registered.
 *
 * Case-insensitive: `REPORT.PDF` off a Windows share is the same document as
 * `report.pdf`.
 */
export function documentToolsFor(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    const tool = EXTRACTORS[match[1].toLowerCase()];
    if (tool !== undefined) found.add(tool);
  }
  return DOCUMENT_TOOLS.filter((tool) => found.has(tool));
}
