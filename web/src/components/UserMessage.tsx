import { useEffect, useRef, useState } from "react";
import type { ChatItem, WireImage } from "@pi-outpost/shared";

type UserItem = Extract<ChatItem, { kind: "user" }>;

interface UserMessageProps {
  item: UserItem;
  /** Editing rewinds the session — refused mid-run, and needs a persisted entry id. */
  canEdit: boolean;
  onEdit: (entryId: string, text: string, images?: WireImage[]) => void;
}

/**
 * A sent prompt, editable: re-sending a modified version rewinds to just before
 * it and asks again, so the new answer branches off (the original exchange stays
 * reachable in the conversation tree). Attached images ride along unchanged.
 */
export function UserMessage({ item, canEdit, onEdit }: UserMessageProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editable = canEdit && item.entryId !== undefined;
  const editing = draft !== null;

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

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

  return (
    <div className="group ml-auto flex max-w-[85%] items-start gap-1.5">
      {editable && !editing && (
        <button
          type="button"
          onClick={() => setDraft(item.text)}
          title="edit this prompt and ask again (branches the conversation)"
          aria-label="Edit this prompt"
          className="mt-1.5 shrink-0 rounded px-1 py-0.5 text-xs text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          ✎
        </button>
      )}
      <div className="min-w-0 flex-1 rounded-xl bg-blue-100 px-4 py-2 text-[15px] text-blue-950 dark:bg-blue-950/60 dark:text-zinc-100">
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
                {canEdit
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
                send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
