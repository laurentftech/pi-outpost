/**
 * The open workspaces: each project's main session, keyed by its resolved root, and
 * the side sessions opened on those projects, keyed by their own id.
 *
 * Thin on purpose. What it exists to own is the *identity* rule — a directory maps
 * to at most one main session — because that is what makes opening an already-open
 * directory a lookup rather than a duplicate. Side sessions are the deliberate
 * exception: several agents on one directory, sharing its session store, each with a
 * conversation of its own — which is why a conversation may be live in only one of
 * them at a time (the server enforces that; see `liveElsewhere` in index.ts).
 *
 * It is not a lifecycle manager: opening and retiring are the server's business,
 * because both have to persist the open set and talk to clients first.
 */
import type { Workspace } from "./workspace.ts";

export class WorkspaceRegistry {
  private readonly byId = new Map<string, Workspace>();

  private defaultRoot: string | undefined;

  /** The last side-session rank used per project, so an id is never reused while the server runs. */
  private readonly sideCounters = new Map<string, number>();

  add(workspace: Workspace): Workspace {
    const existing = this.byId.get(workspace.id);
    if (existing) return existing;
    this.byId.set(workspace.id, workspace);
    if (!workspace.isSide) this.defaultRoot ??= workspace.root;
    return workspace;
  }

  /** A workspace by id — for a main session, its root. */
  get(id: string): Workspace | undefined {
    return this.byId.get(id);
  }

  remove(id: string): void {
    this.byId.delete(id);
    if (this.defaultRoot !== id) return;
    // The default just closed: promote whatever remains rather than leaving the
    // server with no answer for a connection that names nothing.
    this.defaultRoot = this.projects().next().value?.root;
  }

  /** The main session of the first project opened that is still open. */
  get default(): Workspace | undefined {
    return this.defaultRoot === undefined ? undefined : this.byId.get(this.defaultRoot);
  }

  /** How many projects are open — side sessions are not projects. */
  get size(): number {
    return [...this.projects()].length;
  }

  /** Every open workspace, main and side sessions alike. */
  all(): Iterable<Workspace> {
    return this.byId.values();
  }

  /** Each open project's main session. */
  *projects(): IterableIterator<Workspace> {
    for (const workspace of this.byId.values()) if (!workspace.isSide) yield workspace;
  }

  /** Every session open on a project's directory: its main session first, then its side sessions. */
  sessionsOf(root: string): Workspace[] {
    return [...this.byId.values()]
      .filter((workspace) => workspace.root === root)
      .sort((a, b) => (a.sideIndex ?? 0) - (b.sideIndex ?? 0));
  }

  /** The rank of the next side session on a project. */
  nextSideIndex(root: string): number {
    const next = (this.sideCounters.get(root) ?? 0) + 1;
    this.sideCounters.set(root, next);
    return next;
  }
}
