/**
 * A conversation, taken away.
 *
 * Nothing here is reached from the main bundle: the header imports this module with
 * `import()` inside its click handler, so a session that never exports never downloads
 * mermaid or the markdown pipeline. Same boundary as the Word export next door, and
 * `scripts/check-export-chunk.mjs` is what keeps it from quietly disappearing.
 *
 * The export collects the conversation itself rather than reading what is on screen.
 * That is the whole reason it exists in this shape: the transcript a reader has open
 * starts wherever compaction cut it, and a file named after the conversation must not
 * contain a fraction of it without saying so.
 */
import type { ChatItem } from "@pi-outpost/shared";
import { collectOlderItems, type HistoryFetch } from "../conversationHistory";
import { save } from "../util/download";
import { referenceUrl } from "./loadReferencedImage";
import { inlineStyles, renderDiagram, svgDimensions, withExplicitSize } from "./mermaidToImage";
import {
  conversationToHtml,
  type ConversationMeta,
  type InlineImage,
  DEFAULT_BUDGET_BYTES,
} from "./conversationHtml";

/** Where the conversation's own files are reached, and with what credentials. */
export interface ExportConnection {
  serverUrl: string;
  token: string | null;
}

export interface ConversationExportOptions {
  /** The items on screen — the tail of the conversation the model still holds. */
  items: ChatItem[];
  /** How many items precede them, from the snapshot; 0 when nothing was compacted. */
  olderItems: number;
  /** How the missing prefix is fetched. Absent when this deployment cannot serve it. */
  fetchOlderItems?: HistoryFetch;
  connection: ExportConnection;
  meta: ConversationMeta;
  budgetBytes?: number;
  /** Progress, so a conversation with many diagrams does not look like a hang. */
  onProgress?: (stage: "collecting" | "rendering", done: number, total: number) => void;
}

/** The export could not be produced, and no file was handed over. */
export class ConversationExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationExportError";
  }
}

/**
 * A workspace reference as bytes inside the document.
 *
 * Built on the same helper the transcript's own `img` uses, so a picture that draws on
 * screen and a picture that travels in the file cannot become different pictures. A
 * reference this application would not load is not loaded here either: nothing off the
 * origin that served the app, which is also what keeps an export from phoning home.
 */
async function inlineImageLoader(connection: ExportConnection): Promise<(src: string) => Promise<InlineImage | undefined>> {
  const cache = new Map<string, InlineImage | undefined>();
  return async (src: string) => {
    if (cache.has(src)) return cache.get(src);
    const url = referenceUrl("", src, connection.serverUrl, connection.token);
    let image: InlineImage | undefined;
    if (url !== undefined) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const type = response.headers.get("content-type") ?? "application/octet-stream";
          image = { dataUrl: `data:${type};base64,${base64(bytes)}`, bytes: bytes.byteLength };
        }
      } catch {
        // A file that has been deleted, a server that has gone away: the conversation is
        // worth more than the picture, and the document says so where it was.
        image = undefined;
      }
    }
    cache.set(src, image);
    return image;
  };
}

/** Base64 without a data-url round trip, in chunks so a large image cannot blow the stack. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * A mermaid source as inline SVG, sized and with its styles written in.
 *
 * The raster the Word export also needs is not built here: an HTML document draws the
 * vector itself, and a second copy of every diagram would double the file for readers
 * who never see it.
 */
async function inlineDiagram(source: string, id: string): Promise<string | undefined> {
  try {
    const { svg } = await renderDiagram(source, id);
    const { width, height } = svgDimensions(svg);
    return inlineStyles(withExplicitSize(svg, width, height));
  } catch {
    // The caller leaves the source text in the document instead.
    return undefined;
  }
}

/** What the downloaded file is called: the session, the date, and nothing a filesystem refuses. */
export function conversationFileName(session: string, exportedAt: Date): string {
  const stem = session
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const day = exportedAt.toISOString().slice(0, 10);
  return `${stem || "conversation"}-${day}.html`;
}

/**
 * Produce the document. Either the whole conversation, or nothing.
 *
 * A partial archive cannot be told from a complete one once it has been sent, so every
 * way of ending up with less than the conversation — a runtime that cannot read its own
 * branch, a request that failed halfway, media past the budget — refuses instead.
 */
export async function buildConversationHtml(options: ConversationExportOptions): Promise<string> {
  if (options.items.length === 0) {
    throw new ConversationExportError("there is no conversation to export yet");
  }
  let older: ChatItem[] = [];
  if (options.olderItems > 0) {
    if (!options.fetchOlderItems) {
      throw new ConversationExportError(
        "this conversation has been compacted and the agent runtime cannot read back what it removed, so it cannot be exported in full",
      );
    }
    try {
      older = await collectOlderItems(options.fetchOlderItems, (collected) =>
        options.onProgress?.("collecting", collected, options.olderItems),
      );
    } catch (cause) {
      throw new ConversationExportError(
        `the earlier part of the conversation could not be read back, so nothing was exported: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  const items = [...older, ...options.items];
  return conversationToHtml(items, {
    meta: options.meta,
    loadImage: await inlineImageLoader(options.connection),
    renderDiagram: inlineDiagram,
    budgetBytes: options.budgetBytes ?? DEFAULT_BUDGET_BYTES,
    onProgress: (rendered, total) => options.onProgress?.("rendering", rendered, total),
  });
}

/** Build the document and hand it to the browser. Nothing is written into the workspace. */
export async function exportConversation(options: ConversationExportOptions): Promise<void> {
  const html = await buildConversationHtml(options);
  save(new Blob([html], { type: "text/html;charset=utf-8" }), conversationFileName(options.meta.session, options.meta.exportedAt));
}
