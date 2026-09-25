/**
 * Markdown as Word structure, in the browser.
 *
 * The mapping itself lives in `@pi-outpost/shared`, where the server's Word tools use
 * it too. What only the browser does is supplied here: drawing mermaid diagrams, and
 * fetching the pictures a document references from the server, resolved against the
 * document's own directory as the viewer resolves them on screen.
 */
import { markdownToDocx as mapMarkdown, type DocxBlock } from "@pi-outpost/shared/docx";
import { renderDiagram } from "./mermaidToImage";
import { loadReference, referenceUrl } from "./loadReferencedImage";

export { parseMarkdown, diagramSize, ORDERED_NUMBERING, type DocxBlock } from "@pi-outpost/shared/docx";

export async function markdownToDocx(
  text: string,
  options?: { path?: string; serverUrl?: string; token?: string | null },
): Promise<DocxBlock[]> {
  const path = options?.path ?? "";
  const serverUrl = options?.serverUrl ?? "";
  const token = options?.token ?? null;
  return mapMarkdown(text, {
    imageKey: (src) => referenceUrl(path, src, serverUrl, token),
    loadImage: (src) => loadReference(path, src, serverUrl, token),
    renderDiagram,
  });
}
