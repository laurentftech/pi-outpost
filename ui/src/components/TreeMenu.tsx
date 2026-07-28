import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "@pi-outpost/shared";

interface TreeMenuProps {
  tree: TreeNode[] | null;
  isStreaming: boolean;
  onListTree: () => void;
  onNavigate: (entryId: string) => void;
  onFork: (entryId: string) => void;
}

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

/**
 * One lane per branch, git-log style. Lane 0 is the current path (onPath sorts
 * first among both children and roots), and emerald is reserved for it — the
 * other lanes cycle through the remaining colors, so no dead branch ever wears
 * the "you are here" color.
 */
const CURRENT_COLOR = "#10b981";
const BRANCH_COLORS = ["#8b5cf6", "#f59e0b", "#0ea5e9", "#f43f5e", "#14b8a6", "#d946ef"];
const LANE_W = 14;
const ROW_H = 36;

function laneColor(lane: number): string {
  return lane === 0 ? CURRENT_COLOR : BRANCH_COLORS[(lane - 1) % BRANCH_COLORS.length];
}

interface GraphRow {
  node: TreeNode;
  lane: number;
  /** Lanes whose vertical rail passes through this row (other branches running in parallel). */
  through: number[];
  /** Extra lanes forked off at this node (curves out of the circle). */
  forkTo: number[];
  /** Rail arrives from above (false only for tree roots). */
  lineAbove: boolean;
  /** Rail continues below (the node has children). */
  lineBelow: boolean;
  /** Ordinal of this node's branch at its fork ("branch 2" chips). */
  branchIndex?: number;
  /** Leaf of the current path — where the conversation stands now. */
  isCurrent: boolean;
}

function layoutGraph(roots: TreeNode[]): { rows: GraphRow[]; laneCount: number; branchPoints: number } {
  const rows: GraphRow[] = [];
  const active = new Set<number>();
  let laneCount = 0;
  let branchPoints = 0;

  function walk(node: TreeNode, lane: number, lineAbove: boolean, branchIndex?: number) {
    // Current path first: it keeps the parent's lane, so lane 0 is the highlighted branch
    const kids = [...node.children].sort((a, b) => Number(b.onPath) - Number(a.onPath));
    const extras = kids.slice(1).map((kid) => {
      const extraLane = laneCount++;
      return [kid, extraLane] as const;
    });
    if (extras.length > 0) branchPoints++;
    rows.push({
      node,
      lane,
      through: [...active].filter((l) => l !== lane),
      forkTo: extras.map(([, l]) => l),
      lineAbove,
      lineBelow: kids.length > 0,
      branchIndex,
      isCurrent: node.onPath && !kids.some((kid) => kid.onPath),
    });
    if (kids.length === 0) {
      active.delete(lane);
      return;
    }
    for (const [, l] of extras) active.add(l);
    walk(kids[0], lane, true, extras.length > 0 ? 1 : undefined);
    extras.forEach(([kid, l], i) => walk(kid, l, true, i + 2));
  }

  // Sibling roots ARE branches: rewinding to the first user turn moves the leaf
  // before it, so re-prompting from there creates a new root. Current path first,
  // like children, so it lands on lane 0 and keeps the current-branch color.
  if (roots.length > 1) branchPoints++;
  const orderedRoots = [...roots].sort((a, b) => Number(b.onPath) - Number(a.onPath));
  orderedRoots.forEach((root, i) => {
    const lane = laneCount++;
    active.add(lane);
    walk(root, lane, false, orderedRoots.length > 1 ? i + 1 : undefined);
  });
  return { rows, laneCount, branchPoints };
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** The rail cell: parallel branch lines, this node's circle, and fork-out curves. */
function Rail({ row, laneCount }: { row: GraphRow; laneCount: number }) {
  const width = laneCount * LANE_W + 2;
  const x = (lane: number) => lane * LANE_W + LANE_W / 2 + 1;
  const cx = x(row.lane);
  const cy = ROW_H / 2;
  return (
    <svg width={width} height={ROW_H} viewBox={`0 0 ${width} ${ROW_H}`} aria-hidden className="shrink-0">
      {row.through.map((lane) => (
        <line key={lane} x1={x(lane)} y1={0} x2={x(lane)} y2={ROW_H} stroke={laneColor(lane)} strokeWidth={2} opacity={0.55} />
      ))}
      {row.lineAbove && <line x1={cx} y1={0} x2={cx} y2={cy} stroke={laneColor(row.lane)} strokeWidth={2} />}
      {row.lineBelow && <line x1={cx} y1={cy} x2={cx} y2={ROW_H} stroke={laneColor(row.lane)} strokeWidth={2} />}
      {row.forkTo.map((lane) => (
        <path
          key={lane}
          d={`M ${cx} ${cy} C ${cx} ${ROW_H}, ${x(lane)} ${cy}, ${x(lane)} ${ROW_H}`}
          fill="none"
          stroke={laneColor(lane)}
          strokeWidth={2}
          opacity={0.75}
        />
      ))}
      {row.isCurrent ? (
        <>
          <circle cx={cx} cy={cy} r={6} fill="none" stroke={laneColor(row.lane)} strokeWidth={2} />
          <circle cx={cx} cy={cy} r={2.5} fill={laneColor(row.lane)} />
        </>
      ) : (
        <circle cx={cx} cy={cy} r={4} fill={row.node.onPath ? laneColor(row.lane) : "var(--tree-off, #d4d4d8)"} stroke={laneColor(row.lane)} strokeWidth={row.node.onPath ? 0 : 1.5} />
      )}
    </svg>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "current" | "branch" | "label" }) {
  const classes = {
    current: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    branch: "border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
    label: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300",
  }[tone];
  return <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] leading-4 ${classes}`}>{children}</span>;
}

const ACTION_CLASS =
  "shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200";

function GraphRowView({
  row,
  laneCount,
  isStreaming,
  onNavigate,
  onFork,
  onClose,
}: {
  row: GraphRow;
  laneCount: number;
  isStreaming: boolean;
  onNavigate: (entryId: string) => void;
  onFork: (entryId: string) => void;
  onClose: () => void;
}) {
  const { node } = row;
  // Clicking a row restores the state *after* that exchange (reply included).
  // Only when the turn has no reply yet does the click rewind to before it.
  const checkoutId = node.tipId ?? node.entryId;
  return (
    <div
      className={`group flex items-center gap-1 pr-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 ${
        row.isCurrent ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""
      }`}
      style={{ height: ROW_H }}
    >
      <button
        type="button"
        disabled={isStreaming}
        onClick={() => {
          onNavigate(checkoutId);
          onClose();
        }}
        title={
          isStreaming
            ? "unavailable while the agent is running"
            : node.tipId
              ? "restore the conversation at this point (reply included)"
              : "go back to this point"
        }
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left text-sm disabled:opacity-50"
      >
        <Rail row={row} laneCount={laneCount} />
        <span className={`min-w-0 truncate ${node.onPath ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-600 dark:text-zinc-400"}`}>
          {node.text || "(empty)"}
        </span>
        {row.forkTo.length > 0 && <Chip tone="branch">{row.forkTo.length + 1} branches</Chip>}
        {row.branchIndex !== undefined && (
          <Chip tone="branch">
            branch {row.branchIndex}
            {node.onPath && !row.isCurrent ? " · current" : ""}
          </Chip>
        )}
        {row.isCurrent && <Chip tone="current">current</Chip>}
        {node.label && <Chip tone="label">{node.label}</Chip>}
      </button>
      <button
        type="button"
        disabled={isStreaming}
        onClick={() => {
          onNavigate(node.entryId);
          onClose();
        }}
        title="rewind to just before this message (its text comes back in the composer)"
        aria-label="Rewind to before this message"
        className={ACTION_CLASS}
      >
        ↺ redo
      </button>
      <button
        type="button"
        onClick={() => {
          onFork(node.entryId);
          onClose();
        }}
        title="fork a new session from this point"
        className={ACTION_CLASS}
      >
        ⑂ fork
      </button>
    </div>
  );
}

/**
 * Conversation tree dropdown, rendered git-log style: one colored rail per
 * branch, the current path highlighted on lane 0, fork points curve out to
 * their branch's rail. Every node is a user turn to rewind to (same session,
 * branches preserved) or to fork into a new session.
 */
export function TreeMenu({ tree, isStreaming, onListTree, onNavigate, onFork }: TreeMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useClickOutside(() => setOpen(false));

  // Snapshots reset the tree to null (session switched, branch changed):
  // refetch instead of stranding an open menu on "loading…"
  useEffect(() => {
    if (open && tree === null) onListTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tree]);

  const graph = useMemo(() => (tree && tree.length > 0 ? layoutGraph(tree) : null), [tree]);
  const matches = useMemo(() => {
    if (!tree || !query.trim()) return null;
    const q = query.trim().toLowerCase();
    // Labels are the most memorable handle on an abandoned branch — search them too
    return flatten(tree).filter(
      (node) => node.text.toLowerCase().includes(q) || node.label?.toLowerCase().includes(q),
    );
  }, [tree, query]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setQuery("");
            onListTree();
          }
        }}
        title="conversation tree: go back to an earlier point or fork"
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
      >
        tree
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex max-h-[70vh] w-[32rem] max-w-[90vw] flex-col rounded-lg border border-zinc-200 bg-white shadow-xl [--tree-off:#e4e4e7] dark:border-zinc-700 dark:bg-zinc-900 dark:[--tree-off:#3f3f46]">
          {tree === null && <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>}
          {tree?.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">no messages yet</div>}
          {tree && tree.length > 0 && graph && (
            <>
              <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Conversation tree</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {graph.rows.length} turn{graph.rows.length === 1 ? "" : "s"} · {graph.branchPoints} branch point
                    {graph.branchPoints === 1 ? "" : "s"}
                  </span>
                </div>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tree"
                  aria-label="Search conversation tree"
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
                />
                <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                  Follow the colored lines — the current branch is highlighted. Click a turn to restore the
                  conversation there · ↺ to send it again · ⑂ to fork a session
                </p>
              </div>
              <div className="min-h-0 overflow-y-auto py-1">
                {matches !== null
                  ? matches.length === 0
                    ? <div className="px-3 py-2 text-xs text-zinc-500">no matches</div>
                    : matches.map((node) => (
                        <div key={node.entryId} className="group flex items-center gap-1 pr-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/70">
                          <button
                            type="button"
                            disabled={isStreaming}
                            onClick={() => {
                              onNavigate(node.tipId ?? node.entryId);
                              setOpen(false);
                            }}
                            title={node.tipId ? "restore the conversation at this point (reply included)" : "go back to this point"}
                            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm disabled:opacity-50"
                          >
                            <span aria-hidden className={node.onPath ? "text-emerald-500" : "text-zinc-300 dark:text-zinc-600"}>●</span>
                            <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">{node.text || "(empty)"}</span>
                            {node.onPath && <Chip tone="current">on current branch</Chip>}
                            {node.label && <Chip tone="label">{node.label}</Chip>}
                          </button>
                          <button
                            type="button"
                            disabled={isStreaming}
                            onClick={() => {
                              onNavigate(node.entryId);
                              setOpen(false);
                            }}
                            title="rewind to just before this message (its text comes back in the composer)"
                            aria-label="Rewind to before this message"
                            className={ACTION_CLASS}
                          >
                            ↺ redo
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onFork(node.entryId);
                              setOpen(false);
                            }}
                            title="fork a new session from this point"
                            className={ACTION_CLASS}
                          >
                            ⑂ fork
                          </button>
                        </div>
                      ))
                  : graph.rows.map((row) => (
                      <GraphRowView
                        key={row.node.entryId}
                        row={row}
                        laneCount={graph.laneCount}
                        isStreaming={isStreaming}
                        onNavigate={onNavigate}
                        onFork={onFork}
                        onClose={() => setOpen(false)}
                      />
                    ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
