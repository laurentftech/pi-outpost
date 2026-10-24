/**
 * The poster editor in an Open WebUI embed: @pi-outpost/posters' editor, with no saving.
 *
 * The user's browser has no route to this server — the embed is a page Open WebUI keeps
 * in the chat — so touch-ups stay in the page: the downloads carry them, the model does
 * not see them, and the page says so (openwebui-posters: TouchUpsStayInTheBrowser).
 * Downloads are links in the page itself, which Open WebUI's frame allows.
 *
 * Open WebUI draws tool embeds in a frame allowed the same origin only when the user
 * turned that on; without it GrapesJS cannot reach its canvas, and the editor shows the
 * poster read-only, with its downloads (EmbedWithoutSameOriginIsReadOnly).
 */
import { mountEditor, type DeliveredFile } from "@pi-outpost/posters/editor";
import type { PosterFormat } from "@pi-outpost/posters/format";
import "@pi-outpost/posters/editor.css";

export interface EmbeddedPoster {
  id: string;
  title: string;
  revision: number;
  html: string;
  css: string;
  format: PosterFormat;
}

export const TOUCH_UPS_NOTICE =
  "Your changes stay in this page: your downloads carry them, but the model does not see them. To change the poster with the model, ask it.";

function deliver(file: DeliveredFile): Promise<string> {
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mediaType }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return Promise.resolve(`Downloaded "${file.name}".`);
}

const root = document.getElementById("root")!;
export const CANNOT_EDIT_NOTICE =
  "Editing needs Open WebUI's “iframe Sandbox Allow Same Origin” setting, in your settings; until it is on, the poster is shown as it is, and the downloads work.";

const editor = mountEditor(root, { deliver, notice: TOUCH_UPS_NOTICE, cannotEditNotice: CANNOT_EDIT_NOTICE });
editor.setDisplayMode("inline");

// Open WebUI sends its frames no theme: the page follows the system's, as the other embeds do.
const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
editor.setTheme(dark?.matches ? "dark" : "light");
dark?.addEventListener?.("change", (event) => editor.setTheme(event.matches ? "dark" : "light"));

// Open WebUI sizes the frame from this message (as the planning embed does).
function reportHeight() {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (height > 0) parent.postMessage({ type: "iframe:height", height }, "*");
}
new ResizeObserver(reportHeight).observe(document.documentElement);

const payload = document.getElementById("poster")?.textContent;
if (!payload) root.textContent = "This poster could not be drawn: there is nothing in this page.";
else editor.open({ ...(JSON.parse(payload) as EmbeddedPoster), readOnly: true });
