/**
 * "pi-outpost was updated" — what changed since the version that ran before, read from
 * the changelog the server carries, so it needs no network.
 *
 * Collapsed to one line until asked: an update is good news, not a dialog to get past.
 * Dismissing it is remembered per version in this browser, like the update notice; the
 * server keeps offering it for as long as the updated version runs, so every browser
 * that has not seen it yet still does.
 */
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OutpostChanges } from "@pi-outpost/shared";

const DISMISSED_KEY = "pi-outpost:changes-notice-dismissed";

function dismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** A changelog link leaves the app for GitHub; it must not replace it. */
function ExternalLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} target="_blank" rel="noreferrer" />;
}

export function ChangesNotice({ changes }: { changes: OutpostChanges }) {
  const [dismissed, setDismissed] = useState(() => dismissedVersion());
  const [open, setOpen] = useState(false);
  if (dismissed === changes.to) return null;
  const hasEntries = changes.entries.length > 0;
  return (
    <div
      role="status"
      data-testid="changes-notice"
      className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
    >
      <div className="flex items-center gap-2 px-4 py-1.5">
        {/* The one spot of colour: news to notice, not an alarm to act on — and not
            emerald, which this app keeps for "you are here" */}
        <span className="shrink-0 rounded-full bg-sky-100 px-1.5 font-medium leading-4 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">New</span>
        <span className="min-w-0 flex-1">
          pi-outpost was updated to {changes.to} (from {changes.from}).
        </span>
        {hasEntries ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="shrink-0 rounded px-1.5 font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
          >
            {open ? "Hide what changed" : "What's changed"}
          </button>
        ) : (
          <ExternalLink href={changes.releaseNotes} className="shrink-0 font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100">
            Release notes
          </ExternalLink>
        )}
        <button
          type="button"
          aria-label="Dismiss the update news"
          onClick={() => {
            try {
              window.localStorage.setItem(DISMISSED_KEY, changes.to);
            } catch {
              // Storage refused: the news goes for now and comes back next time.
            }
            setDismissed(changes.to);
          }}
          className="shrink-0 rounded px-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          ×
        </button>
      </div>
      {open && hasEntries && (
        <div data-testid="changes-notice-body" className="max-h-[50vh] overflow-y-auto border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {/* On the conversation's own column: one reading axis down the page, at a
              measure a page of notes reads at rather than the width of the window */}
          <div className="mx-auto max-w-3xl">
            {changes.entries.map((entry) => (
              <section key={entry.version} className="mb-4">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {entry.version}
                  {entry.date && <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">{entry.date}</span>}
                </h2>
                <div className="prose-chat text-zinc-800 dark:text-zinc-200">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ExternalLink }}>
                    {entry.markdown}
                  </ReactMarkdown>
                </div>
              </section>
            ))}
            <ExternalLink href={changes.releaseNotes} className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100">
              Release notes on GitHub
            </ExternalLink>
          </div>
        </div>
      )}
    </div>
  );
}
