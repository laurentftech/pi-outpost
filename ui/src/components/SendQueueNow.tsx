import { useEffect, useState } from "react";

interface SendQueueNowProps {
  /** A turn is running: sending now stops it first, so ask. */
  isStreaming: boolean;
  /** How many prompts wait; worded in the button. */
  count: number;
  onSend: () => void;
}

/**
 * Send the queued prompts now rather than at the end of the agent's current step — or,
 * after a stop, at all, without typing a new message to carry them.
 *
 * While a turn runs this stops it, which abandons the step in progress (a reply being
 * written is dropped, a running tool stopped); completed work stays. That is said before
 * it happens, inline: a native `confirm()` is blocked silently in a sandboxed embed.
 */
export function SendQueueNow({ isStreaming, count, onSend }: SendQueueNowProps) {
  const [confirming, setConfirming] = useState(false);
  // The turn ended on its own meanwhile: nothing left to interrupt, so nothing to confirm.
  useEffect(() => {
    if (!isStreaming) setConfirming(false);
  }, [isStreaming]);

  const label = count === 1 ? "send it now" : `send all ${count} now`;
  if (!confirming) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => (isStreaming ? setConfirming(true) : onSend())}
          title={isStreaming ? "stop the current step and send the queued messages now" : "send the queued messages now"}
          className="rounded border border-blue-300 px-2 py-0.5 text-xs text-blue-900 hover:bg-blue-50 dark:border-blue-900 dark:text-zinc-300 dark:hover:bg-blue-950/40"
        >
          {label}
        </button>
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label="Confirm sending the queued messages now"
      className="ml-auto flex max-w-[85%] flex-wrap items-center justify-end gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <span className="mr-auto">
        This stops the current step: a reply being written is dropped and a running tool is stopped. Work already done is kept.
      </span>
      <button type="button" onClick={() => setConfirming(false)} className="rounded border border-amber-300 px-2 py-0.5 dark:border-amber-800">
        cancel
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          onSend();
        }}
        className="rounded border border-amber-400 bg-white/70 px-2 py-0.5 font-medium dark:border-amber-700 dark:bg-zinc-900/60"
      >
        stop and send
      </button>
    </div>
  );
}
