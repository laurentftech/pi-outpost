/**
 * What the model reads about the document tools: their OpenAPI descriptions.
 *
 * Weak models follow an example far more reliably than a rule, and never read a
 * reference page they are pointed to; so each tool carries one complete example of
 * the common job, and the rules a model breaks most are said where it will read them.
 */

/** A small transparent PNG, so the examples hold a real picture without a page of base64. */
const EXAMPLE_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const DOCUMENT_EXAMPLE = {
  file_name: "rollout-report",
  markdown: [
    "# Rollout report",
    "",
    "The rollout is on track. Two risks remain.",
    "",
    "## Risks",
    "",
    "- Supplier delay on the boards",
    "- Test bench availability in March",
    "",
    "| Risk | Owner | Status |",
    "| --- | --- | --- |",
    "| Supplier delay | Anna | open |",
    "| Test bench | Marc | mitigated |",
    "",
    "## How a release flows",
    "",
    "```mermaid",
    "flowchart LR",
    "  A[Build] --> B{Tests pass?}",
    "  B -->|yes| C[Release]",
    "  B -->|no| A",
    "```",
    "",
    "## Our logo",
    "",
    `![Company logo](${EXAMPLE_PNG})`,
  ].join("\n"),
};

export const PRESENTATION_EXAMPLE = {
  file_name: "rollout-review",
  slides: [
    { title: "Rollout review", subtitle: "October 2026" },
    { title: "Where we are", bullets: ["Boards delivered", "Firmware in test", "Release planned for March"] },
    { title: "Risks", table: { rows: [["Risk", "Owner", "Status"], ["Supplier delay", "Anna", "open"], ["Test bench", "Marc", "mitigated"]] } },
    { title: "Budget", chart: { type: "column", categories: ["Q1", "Q2", "Q3"], series: [{ name: "Spent (k€)", values: [120, 180, 95] }] } },
    { title: "Release flow", mermaid: "flowchart LR\n  A[Build] --> B{Tests pass?}\n  B -->|yes| C[Release]\n  B -->|no| A" },
  ],
};

export const CREATE_DOCUMENT_DESCRIPTION = [
  "Write a Word document (.docx) the user downloads from the chat. Use it when the user asks for a report, a document, a memo or a Word file.",
  "Give the whole content in `markdown`: headings (#, ##, ###), paragraphs, **bold**, *italic*, lists, tables, links, block quotes, code and LaTeX equations are written in the template's own styles.",
  "Diagrams: write a Mermaid diagram as a ```mermaid fence, or a structured-exchange document (graph, sequence, timeline, table) as a ```json fence, exactly as you would in a reply; each is drawn as a picture in its place.",
  "Pictures: give each picture's bytes in the Markdown as a data: URI, ![alt text](data:image/png;base64,...). PNG, JPEG or GIF only. A web address is not fetched and is refused.",
  "Leave `template` out to use the built-in Word style; call list_templates first only if the user asks for one of their organisation's templates.",
  "If a diagram or a picture is refused, nothing is written: the answer says which one and why; correct it and call again in the same reply.",
  "The answer shows the user a download button; you are not shown the file. Tell the user the document is ready and what it contains.",
  `Example: ${JSON.stringify(DOCUMENT_EXAMPLE)}`,
].join("\n");

export const CREATE_PRESENTATION_DESCRIPTION = [
  "Write a PowerPoint deck (.pptx) the user downloads from the chat. Use it when the user asks for slides, a deck, a presentation or a PowerPoint file.",
  "Give `slides` in order. Each slide may have a `title`, a `subtitle`, `bullets`, and at most ONE of: `table` (rows of texts, the first row the header), `chart` (column, bar, line or pie), `mermaid` (a Mermaid diagram's source), `diagram` (a structured-exchange document) or `image` ({\"data\": \"data:image/png;base64,...\", \"alt\": \"...\"}).",
  "The first slide with only a title and subtitle becomes the title slide. Put each visual on a slide of its own.",
  "Leave `template` out to use the built-in theme; call list_templates first only if the user asks for one of their organisation's templates.",
  "If a slide is refused, nothing is written: the answer says which slide and why; correct it and call again in the same reply.",
  "The answer shows the user a download button; you are not shown the file. Tell the user the deck is ready and what it contains.",
  `Example: ${JSON.stringify(PRESENTATION_EXAMPLE)}`,
].join("\n");

export const LIST_TEMPLATES_DESCRIPTION =
  "List the Word and PowerPoint templates this server's administrator provides, with the styles or layouts each offers. Call it only when the user wants a document in one of their organisation's templates; otherwise leave template out.";

export const FILE_NAME_DESCRIPTION = "The file's name as the user downloads it, without a folder, such as \"rollout-report\". The extension is added.";
export const MARKDOWN_DESCRIPTION = "The document's whole content, in Markdown, with Mermaid and structured-exchange diagrams as fences and pictures as data: URIs.";
export const TEMPLATE_DESCRIPTION = "Optional: a template's name from list_templates. Leave it out for the built-in one.";
export const KEEP_DESCRIPTION = "Optional, Word templates only: keep the template's \"cover\" page and/or its \"toc\" (table of contents) in front of the content.";
export const SLIDES_DESCRIPTION = "The slides, in order.";
