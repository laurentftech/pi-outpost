/**
 * The posters MCP server: posters the model composes in HTML and CSS, shown in the
 * conversation in an editor where the person retouches them — corrects a text, moves a
 * pictogram, changes a colour — saves, so the model's next change starts from her version,
 * and exports to Word or PowerPoint.
 *
 * The model never writes editor code: the editor is this extension's view, from
 * @pi-outpost/posters. It writes the poster once (create_poster), reads it back with the
 * person's touch-ups (get_poster), and changes it from the revision it read (update_poster).
 * The guide in the descriptions is the one every host gives.
 *
 * The view saves through `save_poster` with the revision it loaded — a save over a newer
 * revision is refused rather than overwriting it — and keeps the Word and PowerPoint files
 * it builds through `save_export`. Both are tools only the view can call. They declare no
 * resourceUri: an app-only tool that also named the view left Claude Desktop drawing no
 * view at all for the tool that shows it.
 */
import { createHash } from "node:crypto";
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult, type ReadResourceResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { FORMAT_NAMES, type PosterFormat } from "@pi-outpost/posters/format";
import { POSTER_GUIDE } from "@pi-outpost/posters/guide";
import { PosterRefusal, type LocalPosterStore, type PosterRevision } from "./store.ts";

export const SERVER_NAME = "pi-outpost-posters";

/** The view's URI, named after its content: Claude Desktop keeps a view by its URI. */
export function viewUriFor(html: string): string {
  return `ui://pi-outpost/poster-${createHash("sha256").update(html).digest("hex").slice(0, 12)}.html`;
}

/** What the view receives from show_poster, as structured content. */
export interface ShownPoster {
  id: string;
  title: string;
  revision: number;
  html: string;
  css: string;
  format: PosterFormat;
  file: string;
  folder: string;
  /** The text the model reads, repeated: Claude Code gives the model the structured content instead. */
  summary: string;
}

/** Above this, a file the view hands over is not an export of one poster. */
const MAX_EXPORT_BYTES = 40_000_000;

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] };
}

function refusal(error: unknown): CallToolResult {
  if (error instanceof PosterRefusal) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: error.message, ...error.details }, null, 1) }] };
  throw error;
}

function answer(revision: PosterRevision) {
  return {
    id: revision.id,
    title: revision.title,
    revision: revision.revision,
    current_revision: revision.current,
    format: revision.format,
    file: revision.file,
    last_changed_by: revision.by === "user" ? "the user, in the editor" : "the model",
  };
}

export interface ServerOptions {
  store: LocalPosterStore;
  viewHtml: string;
  version?: string;
  /** Diagnostics: the tools the host calls and the view fetches, which Claude Desktop's logs do not show. */
  log?: (line: string) => void;
}

export function createPosterServer(options: ServerOptions): McpServer {
  const { store } = options;
  const log = options.log;
  const server = new McpServer({ name: SERVER_NAME, version: options.version ?? "0.0.0" });
  const VIEW_URI = viewUriFor(options.viewHtml);
  if (log) {
    server.server.oninitialized = () => {
      const client = server.server.getClientVersion();
      const ui = getUiCapability(server.server.getClientCapabilities());
      log(`initialized by ${client?.name ?? "?"} ${client?.version ?? ""}; MCP Apps: ${ui ? JSON.stringify(ui) : "NOT declared"}`);
    };
  }
  const called = (name: string) => log?.(`tools/call ${name}`);
  const id = z.string().describe("The poster's id, from create_poster or list_posters.");
  const content = {
    html: z.string().describe("The poster's markup: the content of one page, without <html>, <head> or <body>."),
    css: z.string().describe("The poster's stylesheet."),
    format: z.enum(FORMAT_NAMES).describe("The paper format, or slide-16:9 for a poster to project."),
  };

  server.registerTool(
    "list_posters",
    { title: "List the user's posters", description: "Lists the posters in the user's folder: id, title, revision, file.", annotations: { readOnlyHint: true } },
    async () => {
      called("list_posters");
      return text({ folder: store.root, posters: await store.list() });
    },
  );

  server.registerTool(
    "create_poster",
    {
      title: "Create a poster",
      description: `Creates a poster, a worksheet, a slide or any one-page visual, as a printable page in the user's folder. Then call show_poster so the user sees it and can retouch it.\n\n${POSTER_GUIDE}`,
      inputSchema: z.object({ title: z.string().describe("The poster's title; it names the file."), ...content }),
    },
    async ({ title, html, css, format }) => {
      called("create_poster");
      try {
        return text(answer(await store.create(title, { html, css, format })));
      } catch (error) {
        return refusal(error);
      }
    },
  );

  server.registerTool(
    "get_poster",
    {
      title: "Read a poster",
      description:
        "Reads a poster's markup and stylesheet as they are now, with the user's touch-ups made in the editor. Always read it before changing it: the user may have edited it since you wrote it, and your change must keep their edits.",
      inputSchema: z.object({ id, revision: z.number().int().optional().describe("An earlier revision; the latest when omitted.") }),
      annotations: { readOnlyHint: true },
    },
    async ({ id: posterId, revision }) => {
      called("get_poster");
      try {
        const found = await store.get(posterId, revision);
        return text({ ...answer(found), html: found.html, css: found.css });
      } catch (error) {
        return refusal(error);
      }
    },
  );

  server.registerTool(
    "update_poster",
    {
      title: "Change a poster",
      description: `Replaces a poster's markup and stylesheet with a new version made from the revision you read. Start from get_poster's html and css and keep everything the user changed there (texts, colours, positions) unless they asked otherwise. Then call show_poster.\n\n${POSTER_GUIDE}`,
      inputSchema: z.object({ id, base_revision: z.number().int().describe("The revision you read with get_poster."), ...content }),
    },
    async ({ id: posterId, base_revision: base, html, css, format }) => {
      called("update_poster");
      try {
        return text(answer(await store.revise(posterId, base, { html, css, format }, "model")));
      } catch (error) {
        return refusal(error);
      }
    },
  );

  registerAppTool(
    server,
    "show_poster",
    {
      title: "Show a poster to the user",
      description: "Shows a poster in the conversation, in an editor where the user can correct texts, move pictograms, change colours, save, and export it to Word (to print) or PowerPoint (to show).",
      inputSchema: z.object({ id }),
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ id: posterId }): Promise<CallToolResult> => {
      called("show_poster");
      try {
        const current = await store.get(posterId);
        const summary = `Shown to the user in the poster editor: "${current.title}" (${posterId}), revision ${current.revision}, ${current.format}. You do not see it. If the user retouches it and saves, get_poster returns their version.`;
        const shown: ShownPoster = { id: posterId, title: current.title, revision: current.revision, html: current.html, css: current.css, format: current.format, file: current.file, folder: store.root, summary };
        return { content: [{ type: "text", text: summary }], structuredContent: shown as unknown as Record<string, unknown> };
      } catch (error) {
        return refusal(error);
      }
    },
  );

  server.registerTool(
    "save_poster",
    {
      title: "Save the user's touch-ups",
      description: "Called by the poster editor when the user saves. Not for the model.",
      inputSchema: z.object({ id, base_revision: z.number().int(), html: z.string(), css: z.string() }),
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ id: posterId, base_revision: base, html, css }): Promise<CallToolResult> => {
      called("save_poster");
      try {
        const current = await store.get(posterId);
        const saved = await store.revise(posterId, base, { html, css, format: current.format }, "user");
        return { ...text(`Saved as revision ${saved.revision}.`), structuredContent: { revision: saved.revision, file: saved.file } };
      } catch (error) {
        return refusal(error);
      }
    },
  );

  server.registerTool(
    "save_export",
    {
      title: "Keep an exported Word or PowerPoint file",
      description: "Called by the poster editor with the Word or PowerPoint file it built, to keep it beside the poster. Not for the model.",
      inputSchema: z.object({ id, kind: z.enum(["docx", "pptx"]), bytes: z.string().describe("The file, base64.") }),
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ id: posterId, kind, bytes }): Promise<CallToolResult> => {
      called("save_export");
      try {
        const file = Buffer.from(bytes, "base64");
        // Both are zip packages: anything else is not an export.
        if (file.length < 4 || file.length > MAX_EXPORT_BYTES || file.readUInt32LE(0) !== 0x04034b50) throw new PosterRefusal("this is not a Word or PowerPoint file of a usable size");
        const saved = await store.saveExport(posterId, kind, file);
        return { ...text(`Saved as "${saved}" in ${store.root}.`), structuredContent: { file: saved, folder: store.root } };
      } catch (error) {
        return refusal(error);
      }
    },
  );

  registerAppResource(server, "Poster editor", VIEW_URI, { mimeType: RESOURCE_MIME_TYPE, description: "The editor a shown poster is retouched in." }, async (): Promise<ReadResourceResult> => {
    log?.(`resources/read ${VIEW_URI} (${options.viewHtml.length} characters)`);
    // No CSP domains: the page is one self-contained file and fetches nothing.
    return { contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: options.viewHtml }] };
  });

  return server;
}
