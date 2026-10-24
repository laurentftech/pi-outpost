/**
 * The poster editor frame pi-outpost's file viewer hosts (PosterFrame in ui/): the shared
 * editor, asking its parent to save and to hand exported files over, since the frame holds
 * no credentials. Messages: @pi-outpost/posters/frame.
 */
import { mountEditor, type OpenedPoster, type SaveResult } from "@pi-outpost/posters/editor";
import { POSTER_FRAME } from "@pi-outpost/posters/frame";
import "@pi-outpost/posters/editor.css";

const answers = new Map<number, (value: unknown) => void>();
let next = 0;

function ask<T>(type: string, payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = ++next;
  return new Promise<T>((resolve) => {
    answers.set(id, resolve as (value: unknown) => void);
    parent.postMessage({ type, id, ...payload }, "*", transfer);
  });
}

const editor = mountEditor(document.getElementById("root")!, {
  save: ({ html, css }) => ask<SaveResult>(POSTER_FRAME.SAVE, { html, css }),
  deliver: (file) => ask<string>(POSTER_FRAME.DELIVER, { name: file.name, mediaType: file.mediaType, bytes: file.bytes }),
  onDirtyChange: (dirty) => parent.postMessage({ type: POSTER_FRAME.DIRTY, dirty }, "*"),
});
editor.setDisplayMode("fill");

window.addEventListener("message", (event) => {
  if (event.source !== parent) return;
  const message = event.data as { type?: string; id?: number; value?: unknown; poster?: OpenedPoster; theme?: "light" | "dark" };
  if (message.type === POSTER_FRAME.OPEN && message.poster) {
    editor.setTheme(message.theme === "dark" ? "dark" : "light");
    editor.open(message.poster);
  } else if (message.type === POSTER_FRAME.THEME) {
    editor.setTheme(message.theme === "dark" ? "dark" : "light");
  } else if (message.type === POSTER_FRAME.ANSWER && typeof message.id === "number") {
    answers.get(message.id)?.(message.value);
    answers.delete(message.id);
  }
});

parent.postMessage({ type: POSTER_FRAME.READY }, "*");
