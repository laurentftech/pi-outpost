import type { OlderHistory } from "../useAgent";

/**
 * The way back to the beginning of a compacted conversation.
 *
 * Offered only when the server said there is something above the transcript: a control
 * that loads nothing is worse than no control, because it makes the reader doubt what
 * they are looking at rather than trust it.
 */
export function OlderMessages({ older, onLoad }: { older: OlderHistory; onLoad: () => void }) {
  if (older.remaining <= 0 && !older.error) return null;
  const count = older.remaining;
  const label = older.loading
    ? "Loading earlier messages…"
    : `Load ${count} earlier message${count === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col items-center gap-1 pb-2" data-older-messages>
      <button
        type="button"
        onClick={onLoad}
        disabled={older.loading}
        aria-busy={older.loading}
        // Named for what it does, not for where it is: read out of context, "load
        // earlier messages" is an action and "older" is an adjective.
        aria-label={older.loading ? "Loading earlier messages" : `Load ${count} earlier messages`}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:cursor-progress disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        {label}
      </button>
      {older.error && (
        // The transcript is intact; what failed is the request. Saying so is the
        // difference between a reader retrying and a reader concluding the
        // conversation begins here.
        <p role="status" className="text-xs text-red-600 dark:text-red-400">
          {older.error} — try again
        </p>
      )}
    </div>
  );
}
