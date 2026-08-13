import { useState } from "react";
import { DiffBlock } from "../components/DiffBlocks";
import { parseUnifiedDiff } from "./parseUnifiedDiff";
import { RawBody } from "./builtin";
import type { PresentationProps, ToolItem } from "./types";

/** Anchored at the start of the command: a narrow claim, not a scan for diff-shaped text. */
const GIT_DIFF_COMMAND = /^\s*git\s+(diff|show)\b/;

export function gitDiffCommand(item: ToolItem): string | null {
  if (item.toolName !== "bash" || item.args === null || typeof item.args !== "object") return null;
  const command = (item.args as { command?: unknown }).command;
  if (typeof command !== "string" || !GIT_DIFF_COMMAND.test(command)) return null;
  return command;
}

const FILES_SHOWN = 6;

function ActionButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      {children}
    </button>
  );
}

export function GitDiffView({ item, dispatch }: PresentationProps) {
  const files = parseUnifiedDiff(item.output ?? "");
  const [showAll, setShowAll] = useState(false);

  // Nothing recognizable as a diff: the command matched but the output did not.
  if (files.length === 0) return <RawBody item={item} />;

  const shown = showAll ? files : files.slice(0, FILES_SHOWN);

  return (
    <div className="flex flex-col gap-2">
      {shown.map((file) => (
        <div key={file.path} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{file.path}</span>
            <span className="shrink-0 font-mono text-xs">
              <span className="text-emerald-600 dark:text-emerald-400">+{file.added}</span>{" "}
              <span className="text-red-600 dark:text-red-400">−{file.removed}</span>
            </span>
            <span className="ml-auto flex shrink-0 items-center">
              <ActionButton onClick={() => dispatch({ kind: "openFile", path: file.path })}>open</ActionButton>
              <ActionButton onClick={() => dispatch({ kind: "openFileHistory", path: file.path })}>history</ActionButton>
            </span>
          </div>
          <DiffBlock lines={file.lines} />
        </div>
      ))}
      {!showAll && files.length > FILES_SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          show {files.length - FILES_SHOWN} more file{files.length - FILES_SHOWN === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

export const gitDiffPresentation = {
  id: "git-diff",
  match: (item: ToolItem) => gitDiffCommand(item) !== null,
  stable: true,
  showsRawReveal: true,
  Expanded: GitDiffView,
} as const;
