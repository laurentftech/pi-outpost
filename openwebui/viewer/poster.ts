/**
 * The poster editor in an Open WebUI embed: @pi-outpost/posters' editor, with optional saving.
 *
 * The embed is a page Open WebUI keeps in the chat. When configured, saves go through a
 * revision-scoped capability to the
 * owner-scoped server store; without that capability, touch-ups stay in the page.
 * Downloads are links in the page itself, which Open WebUI's frame allows.
 *
 * Open WebUI draws tool embeds in a frame allowed the same origin only when the user
 * turned that on; without it GrapesJS cannot reach its canvas, and the editor shows the
 * poster read-only, with its downloads (EmbedWithoutSameOriginIsReadOnly).
 */
import { mountEditor, type DeliveredFile } from "@pi-outpost/posters/editor";
import type { PosterFormat } from "@pi-outpost/posters/format";
import { followHostTheme } from "./hostTheme";
import "@pi-outpost/posters/editor.css";

export interface EmbeddedPoster {
  id: string;
  title: string;
  revision: number;
  html: string;
  css: string;
  format: PosterFormat;
  saveEndpoint?: string;
  saveTicket?: string;
}

export const TOUCH_UPS_NOTICE =
  "Save your changes to keep them as a new version the model can read. Older poster embeds may need to be shown again after a save.";
export const LOCAL_ONLY_NOTICE =
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

let saveTicket: string | undefined;
let savingPoster: EmbeddedPoster | undefined;
const editor = mountEditor(root, {
  deliver,
  save: async ({ html, css, base }) => {
    const poster = savingPoster;
    if (!poster?.saveEndpoint || !saveTicket) return { saved: false, message: "Saving is not configured for this embed." };
    const response = await fetch(poster.saveEndpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ id: poster.id, base_revision: base, ticket: saveTicket, html, css, format: poster.format }),
    });
    const answer = await response.json().catch(() => ({})) as { ticket?: unknown; revision?: unknown; error?: unknown };
    if (!response.ok) {
      if (response.status === 409) return { saved: false, message: "This embed is out of date. Ask the model to show the latest poster, then save again." };
      return { saved: false, message: typeof answer.error === "string" ? answer.error : `Save failed (${response.status}).` };
    }
    if (typeof answer.ticket !== "string" || !Number.isInteger(answer.revision)) {
      return { saved: false, message: "The server returned an invalid save receipt." };
    }
    saveTicket = answer.ticket;
    return { saved: true, revision: answer.revision as number, message: "Saved as a new version. The model can read these changes." };
  },
  cannotEditNotice: CANNOT_EDIT_NOTICE,
});
editor.setDisplayMode("inline");

followHostTheme((theme) => editor.setTheme(theme));

// Open WebUI sizes the frame from this message (as the planning embed does).
function reportHeight() {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (height > 0) parent.postMessage({ type: "iframe:height", height }, "*");
}
new ResizeObserver(reportHeight).observe(document.documentElement);

const payload = document.getElementById("poster")?.textContent;
if (!payload) root.textContent = "This poster could not be drawn: there is nothing in this page.";
else {
  const poster = JSON.parse(payload) as EmbeddedPoster;
  savingPoster = poster;
  saveTicket = poster.saveTicket;
  const canSave = Boolean(poster.saveEndpoint && poster.saveTicket);
  editor.open({ ...poster, readOnly: !canSave, notice: canSave ? TOUCH_UPS_NOTICE : LOCAL_ONLY_NOTICE });
}
