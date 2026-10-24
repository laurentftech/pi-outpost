/**
 * The messages between pi-outpost's file viewer and the poster editor frame it hosts
 * (`web/poster-editor.html`). The frame holds no credentials: saving and downloading are
 * asked of the parent, which writes through its own file API and checks each message's
 * source.
 *
 *   frame  → parent  READY                              the editor is listening
 *   parent → frame   OPEN    { poster, theme }          show this poster
 *   parent → frame   THEME   { theme }                  the application's theme changed
 *   frame  → parent  SAVE    { id, html, css }          save the poster as shown
 *   frame  → parent  DELIVER { id, name, mediaType, bytes }  hand this exported file to the person
 *   parent → frame   ANSWER  { id, value }              the answer to SAVE or DELIVER
 *   frame  → parent  DIRTY   { dirty }                  unsaved touch-ups appeared or were saved
 *
 * Isomorphic.
 */
export const POSTER_FRAME = {
  READY: "pi-outpost:poster-ready",
  OPEN: "pi-outpost:poster-open",
  THEME: "pi-outpost:poster-theme",
  SAVE: "pi-outpost:poster-save",
  DELIVER: "pi-outpost:poster-deliver",
  ANSWER: "pi-outpost:poster-answer",
  DIRTY: "pi-outpost:poster-dirty",
} as const;

/** Where pi-outpost's server serves the editor frame page (web/dist). */
export const POSTER_EDITOR_PAGE = "poster-editor.html";
