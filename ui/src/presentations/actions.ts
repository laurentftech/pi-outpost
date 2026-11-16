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
  /** `sha256` verifies the bytes before they are shown — see the `openFile` action. */
  readFile: (path: string, sha256?: string) => void;
  fetchGitFileHistory: (path: string) => void;
  fetchGitDiff: (path: string) => void;
  searchFiles: (query: string) => void;
  /**
   * Path from the toplevel of the repository holding the workspace root down to that root;
   * undefined or "" when the root is the toplevel, or is in no repository.
   */
  repositoryRootPrefix?: () => string | undefined;
}

/**
 * A path counted from a repository's toplevel, as the workspace names it — or null for a
 * file the repository holds outside the workspace, which nothing here may open.
 */
export function workspacePathFromRepository(path: string, rootPrefix: string | undefined): string | null {
  const prefix = (rootPrefix ?? "").replace(/\/+$/, "");
  if (prefix === "") return path;
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : null;
}

/**
 * Maps a named action onto the application actions that already exist. A name
 * outside the enumeration reaches nothing: no target is called and no message
 * leaves the client.
 */
export function createActionDispatch(targets: ActionTargets): ActionDispatch {
  const resolve = (action: { path: string; from?: "repository" }): string | null =>
    action.from === "repository" ? workspacePathFromRepository(action.path, targets.repositoryRootPrefix?.()) : action.path;
  return (action) => {
    if (!isToolAction(action)) return;
    switch (action.kind) {
      case "openFile": {
        const path = resolve(action);
        if (path !== null) targets.readFile(path, action.sha256);
        return;
      }
      case "openFileHistory": {
        const path = resolve(action);
        if (path !== null) targets.fetchGitFileHistory(path);
        return;
      }
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
