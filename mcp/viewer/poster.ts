/**
 * The poster editor in an MCP Apps host (Claude Desktop): @pi-outpost/posters' editor,
 * wired to this extension's server.
 *
 * - The host sends show_poster's result; its structured content is the poster to open.
 * - Saving calls `save_poster` with the revision the editor opened; a refusal (the model,
 *   or another card, saved since) is said, never overwritten.
 * - An exported Word or PowerPoint file is kept beside the poster through `save_export`
 *   and offered to the person through the host's download (`ui/download-file`), under the
 *   poster's name as written: an encoded space stays `%20` in the name Claude gives it.
 * - The editor follows the host's theme and display mode.
 *
 * The sandboxed frame has no storage worth the name, so nothing is kept here: the server
 * is the only store.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { mountEditor, type DeliveredFile } from "@pi-outpost/posters/editor";
import type { PosterFormat } from "@pi-outpost/posters/format";
import { restorePictures } from "@pi-outpost/posters/markers";
import "@pi-outpost/posters/editor.css";

/** show_poster's structured content (`ShownPoster` in src/posters/server.ts). */
interface ShownPoster {
  id: string;
  title: string;
  revision: number;
  html: string;
  css: string;
  format: PosterFormat;
  file: string;
  folder: string;
  /** Pictures `html` and `css` show as markers, to fetch with poster_pictures. */
  pictures?: number;
}

const app = new App({ name: "pi-outpost posters", version: "1" });
let shown: ShownPoster | undefined;

function refusalOf(result: CallToolResult): string {
  const said = result.content?.map((block) => ("text" in block ? block.text : "")).join("") ?? "";
  try {
    return (JSON.parse(said) as { error?: string }).error ?? said;
  } catch {
    return said;
  }
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function deliver(file: DeliveredFile): Promise<string> {
  const poster = shown!;
  const blob = base64Of(file.bytes);
  let kept: string | undefined;
  const kind = file.name.endsWith(".docx") ? "docx" : file.name.endsWith(".pptx") ? "pptx" : undefined;
  if (kind) {
    const saved = await app.callServerTool({ name: "save_export", arguments: { id: poster.id, kind, bytes: blob } });
    kept = saved.isError ? undefined : (saved.structuredContent as { file?: string } | undefined)?.file;
  }
  if (app.getHostCapabilities()?.downloadFile) {
    const { isError } = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${file.name}`, mimeType: file.mediaType, blob } }] });
    if (!isError) return kept ? `Downloaded, and kept in your posters folder as "${kept}".` : "Downloaded.";
  }
  if (kept) return `Saved in your posters folder as "${kept}".`;
  return file.name.endsWith(".html") ? `The printable page is in your posters folder: ${poster.file}` : "The file could not be saved or downloaded here.";
}

const editor = mountEditor(document.getElementById("root")!, {
  async save({ html, css, base }) {
    const poster = shown!;
    const result = await app.callServerTool({ name: "save_poster", arguments: { id: poster.id, base_revision: base, html, css } });
    if (result.isError) return { saved: false, message: refusalOf(result) };
    const revision = (result.structuredContent as { revision?: number } | undefined)?.revision ?? base + 1;
    return { saved: true, revision, message: `Saved (revision ${revision}). Claude will start from this version.` };
  },
  deliver,
  toggleFullscreen() {
    const mode = app.getHostContext()?.displayMode === "fullscreen" ? "inline" : "fullscreen";
    void app
      .requestDisplayMode({ mode })
      .then(() => followHost())
      .catch(() => undefined);
  },
});

function followHost() {
  const context = app.getHostContext();
  editor.setTheme(context?.theme === "dark" ? "dark" : "light");
  editor.setDisplayMode(context?.displayMode === "fullscreen" ? "fullscreen" : "inline");
}

app.ontoolresult = async (result) => {
  if (result.isError || !result.structuredContent) return;
  const content = result.structuredContent as unknown as ShownPoster;
  if (typeof content.id !== "string" || typeof content.html !== "string") return;
  shown = content;
  let { html, css } = content;
  if (content.pictures) {
    // The pictures came as markers, kept out of the model's sight: fetched and put back here.
    const fetched = await app.callServerTool({ name: "poster_pictures", arguments: { id: content.id, revision: content.revision } });
    if (shown !== content) return;
    const pictures = (fetched.structuredContent as { pictures?: string[] } | undefined)?.pictures;
    if (fetched.isError || !pictures) {
      editor.open({ title: content.title, html, css, format: content.format, revision: content.revision, readOnly: true, notice: "This poster's pictures could not be loaded: it is shown without them, and not saved from here." });
      return;
    }
    ({ html, css } = restorePictures(html, css, pictures));
  }
  editor.open({ title: content.title, html, css, format: content.format, revision: content.revision });
};
app.onhostcontextchanged = () => followHost();

await app.connect();
followHost();
