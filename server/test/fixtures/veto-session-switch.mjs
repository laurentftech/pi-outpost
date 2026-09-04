/**
 * Cancels every fresh session the server asks for, and nothing else.
 *
 * The SDK honours this veto by keeping the current session alive, which is the
 * state a resource reload has to notice: the worktree has moved, the running
 * agent has not. Only `new` is refused, so the server's own first session — which
 * is not a switch — still starts.
 */
export default function (pi) {
  pi.on("session_before_switch", async (event) => {
    if (event.reason === "new") return { cancel: true };
  });
}
