import type { WorkspaceInfo } from "@pi-outpost/shared";

/**
 * A workspace's identity on the client: its `id`, or its root from a server that
 * predates side sessions. A side session shares its project's root, so anything
 * that is about one conversation — a draft, a notification, "is this the one I am
 * on" — keys on this, and only paths key on `root`.
 */
export function workspaceKey(workspace: Pick<WorkspaceInfo, "root" | "id">): string {
  return workspace.id ?? workspace.root;
}
