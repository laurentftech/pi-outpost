/**
 * The timeline, alone, inside an Open WebUI chat.
 *
 * Open WebUI shows a tool's HTML answer in a sandboxed iframe — scripts allowed,
 * same-origin not — so this page cannot reach its parent's DOM, its storage, or our
 * server, and needs none of them: the planning arrives in the page itself, in a JSON
 * script element the server writes. Two messages go out to the chat, the only channel
 * there is:
 *
 * - `iframe:height`, whenever the timeline's own height changes. The document's
 *   height is no use — it never drops below the frame's default 150 px — so the
 *   timeline's container is measured instead.
 * - `input:prompt`, when the reader selects a task or a milestone: the chat input is
 *   filled with a sentence naming it and the planning, for the reader to finish and
 *   send. Never `input:prompt:submit`: a click is not consent to send anything.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";
import type { ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";
import { StructuredExchangeDocument } from "../../ui/src/presentations/StructuredExchangeView";
import { TimelineView } from "../../ui/src/presentations/TimelineView";
import "@pi-outpost/apps-core/viewer.css";

/** A document shown by show_structure: drawn as pi-outpost draws it, nothing to act on. */
export interface EmbeddedStructure {
  mode: "structure";
  /** Already validated by the server, with pi-outpost's gate. */
  envelope: ValidatedStructuredExchange;
}

export interface EmbeddedPlanning {
  mode?: "planning";
  id: string;
  title: string;
  revision: number;
  data: StructuredTimelineData;
  /** Set when the timeline compares this revision with an earlier one. */
  comparedWith?: number;
}

type Selection = Parameters<NonNullable<Parameters<typeof TimelineView>[0]["onSelect"]>>[0];

/**
 * The sentence the chat input is filled with, in the reader's language: they finish
 * it and send it, so it has to read as the start of what they would write. The
 * identifiers stay as they are — they are what lets the model find the item.
 */
function promptFor(planning: EmbeddedPlanning, selection: Selection, language: string = navigator.language): string | undefined {
  if (!selection) return undefined;
  const french = language.toLowerCase().startsWith("fr");
  const { task, item } = selection;
  const where = french ? `dans le planning « ${planning.title} » (${planning.id})` : `in planning "${planning.title}" (${planning.id})`;
  if (!item) return french ? `À propos de la tâche « ${task.label} » (${task.id}) ${where} : ` : `About task "${task.label}" (${task.id}) ${where}: `;
  const name = item.label ?? item.kind ?? item.id ?? item.type;
  const id = item.id ?? (french ? "sans id" : "no id");
  if (french) {
    const what = item.type === "milestone" ? "du jalon" : "de l'activité";
    const when = item.type === "milestone" ? `le ${item.date}` : `du ${item.start} au ${item.end}`;
    return `À propos ${what} « ${name} » (${id}, tâche ${task.id}, ${when}) ${where} : `;
  }
  const when = item.type === "milestone" ? `on ${item.date}` : `from ${item.start} to ${item.end}`;
  return `About ${item.type} "${name}" (${id}, task ${task.id}, ${when}) ${where}: `;
}

function readPayload(): EmbeddedPlanning | EmbeddedStructure {
  const element = document.getElementById("planning");
  if (!element?.textContent) throw new Error("nothing to draw in this page");
  return JSON.parse(element.textContent) as EmbeddedPlanning | EmbeddedStructure;
}

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

const container = document.getElementById("root")!;
if (prefersDark()) document.documentElement.dataset.theme = "dark";

function reportHeight() {
  const height = Math.ceil(container.getBoundingClientRect().height);
  if (height > 0) parent.postMessage({ type: "iframe:height", height }, "*");
}
new ResizeObserver(reportHeight).observe(container);

try {
  const payload = readPayload();
  createRoot(container).render(
    <StrictMode>
      {payload.mode === "structure" ? (
        // No dispatch: a location the document points at is shown and not followable,
        // as in pi-outpost's file viewer — there is no project here to open it in.
        // The source pane shows the document exactly as validated.
        <StructuredExchangeDocument envelope={payload.envelope} source={JSON.stringify(payload.envelope, null, 2)} />
      ) : (
        <TimelineView
          data={payload.data}
          onSelect={(selection) => {
            const text = promptFor(payload, selection);
            if (text) parent.postMessage({ type: "input:prompt", text }, "*");
          }}
        />
      )}
    </StrictMode>,
  );
} catch (error) {
  container.textContent = `This could not be drawn: ${(error as Error).message}`;
  reportHeight();
}
