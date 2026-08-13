import type { ActionDispatch, ToolAction, ToolActionKind } from "./types";

/** The enumeration. A name outside this set is not an action. */
export const TOOL_ACTION_KINDS: readonly ToolActionKind[] = [
  "openFile",
  "openFileHistory",
  "openWorktreeDiff",
  "searchWorkspace",
] as const;

const KNOWN = new Set<string>(TOOL_ACTION_KINDS);

export function isToolAction(action: { kind: string }): action is ToolAction {
  return KNOWN.has(action.kind);
}

export interface ActionTargets {
  readFile: (path: string) => void;
  fetchGitFileHistory: (path: string) => void;
  fetchGitDiff: (path: string) => void;
  searchFiles: (query: string) => void;
}

/**
 * Maps a named action onto the application actions that already exist. A name
 * outside the enumeration reaches nothing: no target is called and no message
 * leaves the client.
 */
export function createActionDispatch(targets: ActionTargets): ActionDispatch {
  return (action) => {
    if (!isToolAction(action)) return;
    switch (action.kind) {
      case "openFile":
        targets.readFile(action.path);
        return;
      case "openFileHistory":
        targets.fetchGitFileHistory(action.path);
        return;
      case "openWorktreeDiff":
        targets.fetchGitDiff(action.path);
        return;
      case "searchWorkspace":
        targets.searchFiles(action.query);
        return;
    }
  };
}

/** No-op dispatch, for cards rendered outside an application that wires actions. */
export const noopDispatch: ActionDispatch = () => {};
