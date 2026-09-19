/**
 * The registry of open workspaces, with side sessions beside the projects they run on.
 *
 * Only identity is exercised: the registry never touches a workspace's resources, so
 * a stand-in carrying the identity fields is the real contract.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sideSessionId, type Workspace } from "../src/workspace.ts";
import { WorkspaceRegistry } from "../src/workspaceRegistry.ts";

function workspace(root: string, sideIndex?: number): Workspace {
  return {
    root,
    sideIndex,
    id: sideIndex === undefined ? root : sideSessionId(root, sideIndex),
    isSide: sideIndex !== undefined,
  } as Workspace;
}

describe("the workspace registry", () => {
  test("a side session sits beside its project instead of being folded into it", () => {
    const registry = new WorkspaceRegistry();
    const main = registry.add(workspace("/p/alpha"));
    const side = registry.add(workspace("/p/alpha", registry.nextSideIndex("/p/alpha")));
    assert.notEqual(side, main);
    assert.equal(side.id, "/p/alpha#side-1");
    assert.equal(registry.get("/p/alpha"), main, "the root still names the main session");
    assert.equal(registry.get(side.id), side);
    assert.deepEqual(registry.sessionsOf("/p/alpha"), [main, side]);
  });

  test("the same directory opened twice as a project is still one project", () => {
    const registry = new WorkspaceRegistry();
    const first = registry.add(workspace("/p/alpha"));
    assert.equal(registry.add(workspace("/p/alpha")), first);
  });

  test("side sessions are not projects: they neither count nor become the default", () => {
    const registry = new WorkspaceRegistry();
    registry.add(workspace("/p/alpha"));
    registry.add(workspace("/p/alpha", registry.nextSideIndex("/p/alpha")));
    const beta = registry.add(workspace("/p/beta"));
    assert.equal(registry.size, 2);
    assert.deepEqual([...registry.projects()].map((w) => w.id), ["/p/alpha", "/p/beta"]);

    registry.remove("/p/alpha");
    assert.equal(registry.default, beta, "the next project is promoted, not alpha's side session");
  });

  test("a side-session rank is never reused while the server runs", () => {
    const registry = new WorkspaceRegistry();
    const first = registry.nextSideIndex("/p/alpha");
    registry.add(workspace("/p/alpha", first));
    registry.remove(sideSessionId("/p/alpha", first));
    assert.equal(registry.nextSideIndex("/p/alpha"), first + 1);
    assert.equal(registry.nextSideIndex("/p/beta"), 1, "ranks are per project");
  });
});
