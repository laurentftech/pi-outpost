/**
 * What is installed and not yet running, and the restart that runs it.
 *
 * A running server cannot load an extension's new code, whether it came from a pi
 * package or an extension repository; both land here. Only the standalone interface
 * offers the restart — a widget's page does not run the server — and it is confirmed,
 * because every open window drops and reconnects.
 */
import { useState } from "react";

interface RestartNeededProps {
  reasons: string[];
  canRestart: boolean;
  restarting: boolean;
  onRestart: () => void;
}

export function RestartNeeded({ reasons, canRestart, restarting, onRestart }: RestartNeededProps) {
  const [confirming, setConfirming] = useState(false);
  if (reasons.length === 0) return null;
  return (
    <div className="mt-3 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200" data-testid="restart-needed">
      <p>Installed and waiting on a restart to run: {reasons.join(", ")}.</p>
      {!canRestart ? null : restarting ? (
        <p className="mt-1">Restarting pi-outpost…</p>
      ) : confirming ? (
        <div className="mt-1">
          <p>pi-outpost stops and starts again in the same terminal. Every open window reconnects by itself, and conversations are kept.</p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRestart();
              }}
              className="rounded bg-sky-700 px-2 py-0.5 text-white hover:bg-sky-800"
            >
              Restart now
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded px-2 py-0.5 hover:bg-sky-100 dark:hover:bg-sky-900/50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-1 rounded border border-sky-300 px-2 py-0.5 hover:bg-sky-100 dark:border-sky-700 dark:hover:bg-sky-900/50"
        >
          Restart pi-outpost
        </button>
      )}
    </div>
  );
}
