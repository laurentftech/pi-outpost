import { useEffect, useRef, useState } from "react";
import type { ChatItem, WireImage } from "@pi-outpost/shared";

type UserItem = Extract<ChatItem, { kind: "user" }>;

interface UserMessageProps {
  item: UserItem;
  /** Editing rewinds the session — refused mid-run, and needs a persisted entry id. */
  canEdit: boolean;
  onEdit: (entryId: string, text: string, images?: WireImage[]) => void;
  /**
   * A prompt still waiting in the agent's queue, `item.entryId` being its queue id. Editing
   * replaces it in the queue instead of rewinding, and it can be removed.
   */
  queued?: {
    onRemove: () => void;
    /** The open draft, or null once closed: the owner keeps it if the prompt leaves the queue under it. */
    onDraftChange?: (draft: string | null) => void;
  };
}

/**
 * A sent prompt, editable: re-sending a modified version rewinds to just before
 * it and asks again, so the new answer branches off (the original exchange stays
 * reachable in the conversation tree). Attached images ride along unchanged.
 *
 * A queued prompt is drawn the same way, paler, as waiting: the agent has not read it,
 * so the same pencil rewrites it where it stands, and ✕ takes it out. The visible
 * "queued" word sits once under the whole queue (SendQueueNow), not on every bubble.
 */
export function UserMessage({ item, canEdit, onEdit, queued }: UserMessageProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // A removal is on its way: offer nothing more on a prompt about to leave the queue.
  const [removing, setRemoving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editable = canEdit && item.entryId !== undefined && !removing;
  const editing = draft !== null;

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  // Still here a while after: the server refused the removal (and said why). Offer it again.
  useEffect(() => {
    if (!removing) return;
    const timer = setTimeout(() => setRemoving(false), 3000);
    return () => clearTimeout(timer);
  }, [removing]);

  const reportDraft = queued?.onDraftChange;
  useEffect(() => {
    reportDraft?.(draft);
  }, [draft, reportDraft]);

  // A branch change (edit, tree navigation) replaces the items in place — same
  // session id, same list position, different message. Drop the draft: submitting
  // it would edit whatever message now sits here.
  useEffect(() => {
    setDraft(null);
  }, [item.entryId, item.text]);

  function submit() {
    const text = draft?.trim();
    // Never drop the edit silently: a disconnected socket or a running agent keeps
    // the draft open (the send button is disabled) rather than swallowing the text
    if (!canEdit || !item.entryId || !text) return;
    if (text === item.text) {
      setDraft(null);
      return;
    }
    onEdit(item.entryId, text, item.images);
    setDraft(null);
  }

  const actionClass =
    "mt-1.5 shrink-0 rounded px-1 py-0.5 text-xs text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200";
  return (
    <div className="group ml-auto flex max-w-[85%] items-start gap-1.5" {...(queued ? { "data-queued-prompt": item.entryId } : {})}>
      {editable && !editing && (
        <button
          type="button"
          onClick={() => setDraft(item.text)}
          title={queued ? "edit this queued message — the agent has not read it yet" : "edit this prompt and ask again (branches the conversation)"}
          aria-label={queued ? "Edit this queued message" : "Edit this prompt"}
          className={actionClass}
        >
          ✎
        </button>
      )}
      {queued && editable && !editing && (
        <button
          type="button"
          onClick={() => {
            setRemoving(true);
            queued.onRemove();
          }}
          title="remove this queued message — the agent will not read it"
          aria-label="Remove this queued message"
          className={actionClass}
        >
          ✕
        </button>
      )}
      <div
        className={
          // Waiting, the bubble is the same shape, only paler: no frame or heading to read past.
          queued && !editing
            ? "min-w-0 flex-1 rounded-xl bg-blue-50 px-4 py-2 text-[15px] text-blue-950/70 dark:bg-blue-950/25 dark:text-zinc-400"
            : "min-w-0 flex-1 rounded-xl bg-blue-100 px-4 py-2 text-[15px] text-blue-950 dark:bg-blue-950/60 dark:text-zinc-100"
        }
        {...(queued && !editing ? { title: "queued — the agent has not read it yet" } : {})}
      >
        {queued && !editing && <span className="sr-only">queued — not read yet</span>}
        {item.images && item.images.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {item.images.map((image, j) => (
              <img
                key={j}
                src={`data:${image.mimeType};base64,${image.data}`}
                alt=""
                className="max-h-48 max-w-full rounded-lg object-contain"
              />
            ))}
          </div>
        )}
        {!editing ? (
          <div className="whitespace-pre-wrap">{item.text}</div>
        ) : (
          <div>
            <textarea
              ref={textareaRef}
              value={draft}
              aria-label="Edit prompt"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
                if (event.key === "Escape") setDraft(null);
              }}
              rows={Math.min(10, Math.max(2, draft.split("\n").length))}
              className="w-full resize-none rounded-md bg-white/70 px-2 py-1 text-[15px] outline-none ring-1 ring-blue-300 dark:bg-zinc-900/60 dark:ring-blue-900"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2 text-xs">
              <span className="mr-auto text-blue-900/70 dark:text-zinc-400">
                {queued
                  ? canEdit
                    ? "replaces the queued message — the agent has not read it yet"
                    : "waiting: the connection dropped"
                  : canEdit
                    ? "asks again from here — the current answer moves to its own branch"
                    : "waiting: the agent is running (or the connection dropped)"}
              </span>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded border border-blue-300 px-2 py-0.5 hover:bg-white/60 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canEdit || !draft.trim() || draft.trim() === item.text}
                className="rounded border border-blue-400 bg-white/70 px-2 py-0.5 font-medium disabled:opacity-50 dark:border-blue-800 dark:bg-zinc-900/60"
              >
                {queued ? "save" : "send"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
