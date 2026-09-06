import { useEffect, useRef, useState } from "react";
import { ServerPathPicker } from "./ServerPathPicker";
import type { ServerBrowseState, SettingsApplyState } from "../useAgent";

/** Only the parts of the sandbox this control reads: where it is, and whether it may move. */
export interface WorkspaceRootSandbox {
  root: string;
  locks?: { root?: boolean };
}

interface WorkspaceRootControlProps {
  /** The sandbox confining this widget's one workspace, or null when none is configured. */
  sandbox: WorkspaceRootSandbox | null;
  /** The open server-directory listing, or null when nothing has come back yet. */
  browse: ServerBrowseState | null;
  /** In-flight replacement, so a refusal is shown where it was asked for. */
  applyState: SettingsApplyState | null;
  /** Another picker in the header opened: close this one rather than stack it. */
  blocked?: boolean;
  onBrowse: (path: string) => void;
  onCloseBrowser: () => void;
  /** Opening this picker, so whoever coordinates the header can close the others. */
  onOpened: () => void;
  /** The directory the user chose; the caller replaces the sandbox root with it. */
  onSelect: (root: string) => void;
}

/** The last segment of a path, which is what a header has room to say. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/**
 * The one sandbox root a `root`-mode embed may move, at the left of its header.
 *
 * It replaces a root rather than opening a project: the workspace, its identity
 * and its history stay exactly where they are while their file and tool boundary
 * moves — the same thing Settings has always done, in one control instead of a
 * menu. Two states are refusals rather than affordances: a locked root says so
 * and offers nothing, and a server with no sandbox at all says that too, because
 * a chooser there would promise a boundary that does not exist.
 */
export function WorkspaceRootControl(props: WorkspaceRootControlProps) {
  const { sandbox, applyState, blocked = false, onCloseBrowser } = props;
  const [picking, setPicking] = useState(false);
  /** Whether a replacement this control asked for is still in flight. */
  const awaitingApply = useRef(false);

  useEffect(() => {
    // Yield to whichever picker opened after this one: two open at once would
    // compete for the single server-browse listing behind them.
    //
    // Close this picker and nothing else. The control that just opened has
    // already asked for its own listing, and releasing the shared one here would
    // throw away the request it is waiting on — leaving the new picker up with
    // nothing in it, since the answer no longer matches any live request.
    if (blocked && picking) {
      awaitingApply.current = false;
      setPicking(false);
    }
  }, [blocked, picking]);

  useEffect(() => {
    // Closing on the answer, not on the click. A refused replacement leaves the
    // root exactly where it was, so closing the picker on submission would report
    // a move that did not happen and hide the reason it did not.
    if (!awaitingApply.current) return;
    if (applyState?.status === "applying") return;
    if (applyState?.status === "error") {
      awaitingApply.current = false;
      return;
    }
    awaitingApply.current = false;
    setPicking(false);
    onCloseBrowser();
  }, [applyState, onCloseBrowser]);

  if (!sandbox) {
    return (
      <span
        className="rounded-md border border-dashed border-zinc-300 px-2 py-1 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
        title="This server runs without a sandbox, so there is no root to move"
      >
        No sandbox
      </span>
    );
  }

  const locked = sandbox.locks?.root === true;
  const label = basename(sandbox.root);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={locked}
        aria-label={locked ? `Sandbox root: ${sandbox.root} (locked)` : `Sandbox root: ${sandbox.root}`}
        title={locked ? `${sandbox.root} — locked by the server's configuration` : sandbox.root}
        onClick={() => {
          props.onOpened();
          setPicking(true);
          props.onBrowse(sandbox.root);
        }}
        className={`flex max-w-[14rem] items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
          locked
            ? "cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500"
            : "border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
        }`}
      >
        <span className="truncate font-mono">{label}</span>
        {locked ? <span className="text-zinc-400">(locked)</span> : <span aria-hidden="true">▾</span>}
      </button>
      {/* `blocked` is answered in the render, not only by the effect above: an
          effect runs after the render that scheduled it, so a picker yielding to
          another one is still on the page for a frame — and two pickers mean two
          of every control inside them. The effect stays, because the state still
          has to converge; this only stops the overlap being observable. */}
      {picking && !blocked && (
        <div className="absolute left-0 top-full z-20 mt-1 w-[380px] rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {applyState?.status === "error" && (
            <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">
              {applyState.message}
            </p>
          )}
          <ServerPathPicker
            label="Choose the sandbox root"
            browse={props.browse}
            onBrowse={props.onBrowse}
            onSelect={(root) => {
              awaitingApply.current = true;
              props.onSelect(root);
            }}
            onCancel={() => {
              awaitingApply.current = false;
              setPicking(false);
              onCloseBrowser();
            }}
          />
        </div>
      )}
    </div>
  );
}
