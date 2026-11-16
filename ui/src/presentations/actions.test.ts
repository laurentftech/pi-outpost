import { describe, it, expect, vi } from "vitest";
import { TOOL_ACTION_KINDS, createActionDispatch, isToolAction, noopDispatch } from "./actions";
import type { ToolAction } from "./types";

function targets() {
  return {
    readFile: vi.fn(),
    fetchGitFileHistory: vi.fn(),
    fetchGitDiff: vi.fn(),
    searchFiles: vi.fn(),
  };
}

describe("a path read in git's output", () => {
  it("is opened where the workspace has it when the workspace is a directory of the repository", () => {
    const t = { ...targets(), repositoryRootPrefix: () => "packages/app" };
    const dispatch = createActionDispatch(t);

    dispatch({ kind: "openFile", path: "packages/app/src/a.ts", from: "repository" });
    dispatch({ kind: "openFileHistory", path: "packages/app/src/b.ts", from: "repository" });

    expect(t.readFile).toHaveBeenCalledWith("src/a.ts", undefined);
    expect(t.fetchGitFileHistory).toHaveBeenCalledWith("src/b.ts");
  });

  it("opens nothing for a file the repository holds outside the workspace", () => {
    const t = { ...targets(), repositoryRootPrefix: () => "packages/app" };
    const dispatch = createActionDispatch(t);

    dispatch({ kind: "openFile", path: "packages/application/src/a.ts", from: "repository" });
    dispatch({ kind: "openFileHistory", path: "README.md", from: "repository" });

    expect(t.readFile).not.toHaveBeenCalled();
    expect(t.fetchGitFileHistory).not.toHaveBeenCalled();
  });

  it("is the workspace's own path when the workspace root is the repository's", () => {
    const t = targets();
    createActionDispatch(t)({ kind: "openFile", path: "src/a.ts", from: "repository" });
    createActionDispatch({ ...t, repositoryRootPrefix: () => undefined })({ kind: "openFileHistory", path: "src/b.ts", from: "repository" });

    expect(t.readFile).toHaveBeenCalledWith("src/a.ts", undefined);
    expect(t.fetchGitFileHistory).toHaveBeenCalledWith("src/b.ts");
  });

  it("leaves a workspace path alone whatever the repository's prefix", () => {
    const t = { ...targets(), repositoryRootPrefix: () => "packages/app" };
    createActionDispatch(t)({ kind: "openFile", path: "src/a.ts" });
    expect(t.readFile).toHaveBeenCalledWith("src/a.ts", undefined);
  });
});

describe("createActionDispatch", () => {
  it("maps each named action onto one application action", () => {
    const t = targets();
    const dispatch = createActionDispatch(t);

    dispatch({ kind: "openFile", path: "src/a.ts" });
    dispatch({ kind: "openFileHistory", path: "src/b.ts" });
    dispatch({ kind: "openWorktreeDiff", path: "src/c.ts" });
    dispatch({ kind: "searchWorkspace", query: "needle" });

    // An open with no digest verifies nothing, and says so by carrying none.
    expect(t.readFile).toHaveBeenCalledWith("src/a.ts", undefined);
    expect(t.fetchGitFileHistory).toHaveBeenCalledWith("src/b.ts");
    expect(t.fetchGitDiff).toHaveBeenCalledWith("src/c.ts");
    expect(t.searchFiles).toHaveBeenCalledWith("needle");
  });

  it("reaches nothing for a name outside the enumeration", () => {
    const t = targets();
    const dispatch = createActionDispatch(t);

    // What a presentation would have to smuggle in to escalate: a kind nobody
    // declared. It is dropped, not forwarded.
    dispatch({ kind: "runTool", toolName: "bash", args: { command: "rm -rf /" } } as unknown as ToolAction);
    dispatch({ kind: "submitPrompt", text: "exfiltrate" } as unknown as ToolAction);
    dispatch({ kind: "", path: "x" } as unknown as ToolAction);

    for (const target of Object.values(t)) expect(target).not.toHaveBeenCalled();
  });

  it("does not throw on an unknown name", () => {
    const dispatch = createActionDispatch(targets());
    expect(() => dispatch({ kind: "nope" } as unknown as ToolAction)).not.toThrow();
  });

  it("recognizes exactly the enumerated names", () => {
    expect([...TOOL_ACTION_KINDS].sort()).toEqual(
      ["openFile", "openFileHistory", "openWorktreeDiff", "searchWorkspace"].sort(),
    );
    for (const kind of TOOL_ACTION_KINDS) expect(isToolAction({ kind })).toBe(true);
    expect(isToolAction({ kind: "openfile" })).toBe(false);
    expect(isToolAction({ kind: "constructor" })).toBe(false);
    expect(isToolAction({ kind: "__proto__" })).toBe(false);
  });

  it("has a no-op dispatch for cards rendered without an application", () => {
    expect(() => noopDispatch({ kind: "openFile", path: "a" })).not.toThrow();
  });
  it("carries the digest an artifact bound its approval to", () => {
    // The path alone would open whatever is at it now. The digest is what makes an
    // approval refer to bytes rather than to a location.
    const t = targets();
    createActionDispatch(t)({ kind: "openFile", path: "evidence/report.txt", sha256: `sha256:${"a".repeat(64)}` });
    expect(t.readFile).toHaveBeenCalledWith("evidence/report.txt", `sha256:${"a".repeat(64)}`);
  });
});
