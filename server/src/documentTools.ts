/**
 * Which document extractors — and presentation tools — a piece of conversation calls for.
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

/**
 * The tools that make, update and check a PowerPoint deck. Published together: each is
 * useless without the others — layouts to choose from, a builder and an editor, and
 * the rendering that shows whether the result reads.
 */
export const PRESENTATION_TOOLS = ["pptx_layouts", "pptx_create", "pptx_update", "pptx_render"];

/** The skill that teaches the loop through them; loading it is asking for them. */
export const PRESENTATION_SKILL = "pptx-from-template";

/**
 * The tools that write, update and check Word documents in a template's styles.
 * Published together, for the same reason as the presentation tools.
 */
export const WORD_TOOLS = ["docx_styles", "docx_create", "docx_update", "docx_restyle", "docx_render"];

/** The skill that teaches the Word loop. */
export const WORD_SKILL = "docx-from-template";

/** Extension → the tools a document of that kind calls for. */
const EXTRACTORS: Record<string, string[]> = {
  pdf: ["pdf_extract"],
  // A Word document may be read, updated, or be the template a new one is written from.
  docx: ["docx_extract", ...WORD_TOOLS],
  // A .dotx is only ever a template.
  dotx: WORD_TOOLS,
  xlsx: ["xlsx_extract"],
  // A deck may be read, or be the template a new one is built from.
  pptx: ["pptx_extract", ...PRESENTATION_TOOLS],
  // A .potx is only ever a template.
  potx: PRESENTATION_TOOLS,
};

export const DOCUMENT_TOOLS = [...new Set(Object.values(EXTRACTORS).flat())];

/**
 * A path-like token ending in one of the document extensions.
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
const MENTION = /(?:^|[\s"'`<])(?:[^\s"'`<>]*[/\\])?[^\s"'`<>/\\]+\.(pdf|docx|dotx|xlsx|pptx|potx)(?=$|[\s"'`>)\],;:!?.])/gi;

/**
 * The tools the text calls for, in the order they are registered.
 *
 * Case-insensitive: `REPORT.PDF` off a Windows share is the same document as
 * `report.pdf`. Invoking the presentation skill by name (`/skill:pptx-from-template`)
 * calls for the presentation tools even before any file is named.
 */
export function documentToolsFor(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    for (const tool of EXTRACTORS[match[1].toLowerCase()] ?? []) found.add(tool);
  }
  if (new RegExp(`(?:^|\\s)/skill:${PRESENTATION_SKILL}(?=$|\\s)`).test(text)) {
    for (const tool of PRESENTATION_TOOLS) found.add(tool);
  }
  if (new RegExp(`(?:^|\\s)/skill:${WORD_SKILL}(?=$|\\s)`).test(text)) {
    for (const tool of WORD_TOOLS) found.add(tool);
  }
  return DOCUMENT_TOOLS.filter((tool) => found.has(tool));
}

/**
 * The presentation tools a call the agent is making calls for, published inside the
 * same turn.
 *
 * Two cases. Reading the presentation skill's SKILL.md is how a model loads a skill on
 * its own, and the skill is useless without the tools it teaches. And a `path`
 * argument naming a .pptx or .potx — a template found with `find`, a deck the agent
 * just listed — is a template arriving from the agent's side rather than the user's.
 *
 * Only the presentation tools: the extractors stay the user's to bring back by naming
 * a document (the agent spec's "only way back"), so nothing the agent does republishes
 * `pptx_extract`.
 */
export function documentToolsForToolCall(toolName: string, args: unknown): string[] {
  const target = (args as { path?: unknown } | null)?.path;
  if (typeof target !== "string") return [];
  const normalized = target.replace(/\\/g, "/");
  if (toolName === "read" && normalized.endsWith(`/${PRESENTATION_SKILL}/SKILL.md`)) return PRESENTATION_TOOLS;
  if (toolName === "read" && normalized.endsWith(`/${WORD_SKILL}/SKILL.md`)) return WORD_TOOLS;
  if (/\.(docx|dotx)$/i.test(normalized)) return WORD_TOOLS;
  return /\.(pptx|potx)$/i.test(normalized) ? PRESENTATION_TOOLS : [];
}
