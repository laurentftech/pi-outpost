import { useEffect, useState } from "react";

interface SendQueueNowProps {
  /** A turn is running: sending now stops it first, so ask. */
  isStreaming: boolean;
  /** How many prompts wait; worded in the button. */
  count: number;
  /**
   * The queue can be sent now (every prompt is ours and the socket is up). Without it the
   * line still says the prompts are queued, with nothing to click.
   */
  canSend?: boolean;
  onSend: () => void;
}

/**
 * Send the queued prompts now rather than at the end of the agent's current step — or,
 * after a stop, at all, without typing a new message to carry them.
 *
 * While a turn runs this stops it, which abandons the step in progress (a reply being
 * written is dropped, a running tool stopped); completed work stays. That is said before
 * it happens, inline: a native `confirm()` is blocked silently in a sandboxed embed.
 *
 * At rest it is one quiet line under the queue, "queued · send now": the only visible
 * word that the bubbles above are waiting, and a text link rather than a framed button.
 */
export function SendQueueNow({ isStreaming, count, canSend = true, onSend }: SendQueueNowProps) {
  const [confirming, setConfirming] = useState(false);
  // The turn ended on its own meanwhile: nothing left to interrupt, so nothing to confirm.
  // Nor once the queue cannot be sent: a confirmation must never come back without a click.
  useEffect(() => {
    if (!isStreaming || !canSend) setConfirming(false);
  }, [isStreaming, canSend]);

  const label = count === 1 ? "send now" : `send all ${count} now`;
  if (!confirming || !canSend) {
    return (
      <div className="flex justify-end gap-1.5 pr-1 text-xs text-zinc-500">
        <span>queued</span>
        {canSend && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => (isStreaming ? setConfirming(true) : onSend())}
              title={isStreaming ? "stop the current step and send the queued messages now" : "send the queued messages now"}
              className="underline-offset-2 hover:text-blue-700 hover:underline focus-visible:underline dark:hover:text-blue-300"
            >
              {label}
            </button>
          </>
        )}
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
