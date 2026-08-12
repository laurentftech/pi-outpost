/**
 * Lane geometry and palette shared by the app's two commit-style graphs: the
 * conversation tree and the file-history view. They are one visual language, so
 * they read from one set of constants — a change here lands in both.
 */

/** Lane 0's colour. Reserved for the line the reader is standing on, never a dead branch. */
export const CURRENT_COLOR = "#10b981";
export const BRANCH_COLORS = ["#8b5cf6", "#f59e0b", "#0ea5e9", "#f43f5e", "#14b8a6", "#d946ef"];
export const LANE_W = 14;
export const ROW_H = 36;

export function laneColor(lane: number): string {
  return lane === 0 ? CURRENT_COLOR : BRANCH_COLORS[(lane - 1) % BRANCH_COLORS.length];
}

/**
 * Palette for graphs where "you are here" is a *path* rather than a lane, so no
 * lane may claim the reserved colour: the highlighted rows carry it instead.
 */
export function branchColor(lane: number): string {
  return BRANCH_COLORS[lane % BRANCH_COLORS.length];
}

/** Horizontal centre of a lane inside the rail SVG. */
export function laneX(lane: number): number {
  return lane * LANE_W + LANE_W / 2 + 1;
}

export function railWidth(laneCount: number): number {
  return laneCount * LANE_W + 2;
}

/** How a row's node is drawn — what the reader is looking at, not which lane it sits on. */
export type NodeEmphasis = "current" | "filled" | "hollow";

/** Everything the rail needs to draw one row. Both graphs build this from their own layout. */
export interface RailRow {
  lane: number;
  /** Lanes whose vertical rail passes through this row (other branches running in parallel). */
  through: number[];
  /** Lanes forked off at this node — curves leaving downward, towards older rows. */
  forkTo: number[];
  /** Lanes converging into this node — curves arriving from above, from newer rows. */
  mergeFrom?: number[];
  lineAbove: boolean;
  lineBelow: boolean;
  emphasis: NodeEmphasis;
  /** Dashed rail, for a row that is not a commit (the working tree). */
  dashed?: boolean;
  /**
   * This row sits on the highlighted path, so its own node and rail wear the
   * reserved colour wherever the path happens to run. Lets a graph keep its lane
   * assignment structural — and therefore stable while you navigate — instead of
   * reshuffling lanes to keep the highlighted line on lane 0.
   */
  highlight?: boolean;
}
