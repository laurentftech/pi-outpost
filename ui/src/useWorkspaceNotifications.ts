/**
 * Raise a browser notification when a project the user is not watching needs them.
 *
 * Three levels, and the third is a prohibition (see the spec's
 * RaiseAttentionFromABackgroundWorkspace, and the design canvas):
 *
 *  - document in the foreground: the selector's badge alone. Nothing moves,
 *    nothing opens, the focus stays where it is.
 *  - document unattended: the badge plus one notification PER attention episode,
 *    each naming its own — a notification that does not say where to click cannot
 *    be acted on, so a coalesced "2 projects need you" would be worse than none.
 *  - never: a modal over the project the user is currently looking at. A question
 *    raised in one workspace must not seize the screen of another.
 */
import { useEffect, useRef } from "react";
import type { WorkspaceInfo } from "@pi-outpost/shared";
import { workspaceKey } from "./util/workspaceKey";

/** `activeKey` is the bound workspace's `workspaceKey`: a side session is its own workspace. */
export function useWorkspaceNotifications(workspaces: WorkspaceInfo[], activeKey: string | null): void {
  /** Last attention kind notified per workspace; selecting one does not clear it. */
  const notified = useRef<Map<string, WorkspaceInfo["activity"]>>(new Map());

  useEffect(() => {
    if (typeof Notification === "undefined") return;

    const attention = workspaces.filter((workspace) => workspace.needsAttention);
    const backgroundAttention = attention.filter((workspace) => workspaceKey(workspace) !== activeKey);

    // Cleared only by an authoritative activity update that ends attention. Merely
    // selecting the project removes it from `backgroundAttention`, not from here.
    for (const key of [...notified.current.keys()]) {
      if (!attention.some((workspace) => workspaceKey(workspace) === key)) notified.current.delete(key);
    }

    // Asking is the user's call to make; never prompt for permission on our own.
    if (Notification.permission !== "granted") return;
    // The badge already covers the foreground case, and interrupting someone who
    // is looking at the app is the level this design refuses.
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;

    for (const workspace of backgroundAttention) {
      if (notified.current.get(workspaceKey(workspace)) === workspace.activity) continue;
      notified.current.set(workspaceKey(workspace), workspace.activity);
      try {
        const readyForReview = workspace.activity === "ready-for-review";
        new Notification(readyForReview ? `${workspace.name} is ready for review` : `${workspace.name} needs you`, {
          body: readyForReview ? "Background work is ready for review." : "The agent needs an answer to continue.",
          // One notification per project, replaced rather than stacked if that
          // project asks again.
          tag: `pi-outpost:${workspaceKey(workspace)}`,
        });
      } catch {
        // A browser that refuses to construct one is not a failure worth surfacing:
        // the badge is still there, and it is the level that always works.
      }
    }
  }, [workspaces, activeKey]);
}
