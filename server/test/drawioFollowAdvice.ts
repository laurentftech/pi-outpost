/**
 * Follows drawio_check's anchor advice to the letter (drawio-wire-anchors): every exitX/exitY and
 * entryX/entryY value a warning gives for a wire is applied, waypoints a warning says to remove are
 * removed, and the file is checked again, until no warning gives anything to apply or a state
 * repeats. Used by drawioAdvice.test.ts and scripts/probes/drawio-follow-advice.mts.
 */
import { checkDrawio } from "../src/drawio.ts";

/** Sets `key=value` in a style string, replacing the key when present. */
export function setStyle(style: string, key: string, value: string): string {
  const pattern = new RegExp(`(^|;)${key}=[^;]*`);
  if (pattern.test(style)) return style.replace(pattern, `$1${key}=${value}`);
  return `${style}${style.endsWith(";") || style === "" ? "" : ";"}${key}=${value};`;
}

/** The value assignments a report makes, by wire id: from "… for \"id\"" lists and single-wire messages. */
export function advice(messages: string[]): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const put = (id: string, values: string) => {
    const entry = out.get(id) ?? {};
    for (const part of values.split(";")) {
      const [key, value] = part.split("=");
      if (key && value) entry[key] = value;
    }
    out.set(id, entry);
  };
  for (const message of messages) {
    // Shared point: `exitX=1;exitY=0.25 for "w2" (label)`
    for (const match of message.matchAll(/((?:exit|entry)[XY]=[\d.]+;(?:exit|entry)[XY]=[\d.]+) for "([^"]+)"/g)) put(match[2]!, match[1]!);
    // Needless bend from fixed ends: `put its entry level with its exit: entryY=0.5`
    const level = /^connector "([^"]+)".*Fix it: put its (?:entry|exit) level with its (?:exit|entry): ((?:exit|entry)[XY]=[\d.]+)/.exec(message);
    if (level) put(level[1]!, level[2]!);
    // Needless bend: drop the fixed ends
    const dropEnds = /^connector "([^"]+)".*Fix it: drop exitX\/exitY and entryX\/entryY to let draw\.io choose where/.exec(message);
    if (dropEnds) put(dropEnds[1]!, "exitX=none;exitY=none;entryX=none;entryY=none");
    // Own ends / facing away: `connector "w" … (exitX=…;exitY=…[;entryX=…;entryY=…])`
    const single = /^connector "([^"]+)".*?(?:sides facing each other|side facing it) \(((?:(?:exit|entry)[XY]=[\d.]+;?)+)\)/.exec(message);
    if (single) put(single[1]!, single[2]!);
  }
  return out;
}

/** One waypoint to move or remove, by wire: the precise fix a needless-bend warning gives first. */
export interface WaypointFix {
  wire: string;
  from: { x: number; y: number };
  to: { x: number; y: number } | null;
}

export function waypointFixes(messages: string[]): WaypointFix[] {
  return messages.flatMap((message) => {
    const wire = /^connector "([^"]+)"/.exec(message)?.[1];
    if (wire === undefined) return [];
    const move = /Fix it: move its waypoint at \((-?\d+), (-?\d+)\) to \((-?\d+), (-?\d+)\)/.exec(message);
    if (move) return [{ wire, from: { x: Number(move[1]), y: Number(move[2]) }, to: { x: Number(move[3]), y: Number(move[4]) } }];
    const remove = /Fix it: remove its waypoint at \((-?\d+), (-?\d+)\)/.exec(message);
    if (remove) return [{ wire, from: { x: Number(remove[1]), y: Number(remove[2]) }, to: null }];
    return [];
  });
}

/** Moves or removes the named waypoints (in page coordinates; the diagrams here have no nested wires). */
export function applyWaypointFixes(xml: string, fixes: WaypointFix[]): string {
  let out = xml;
  for (const fix of fixes) {
    const escaped = fix.wire.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(<mxCell\\b[^>]*\\bid="${escaped}"[\\s\\S]*?<Array as="points">)([\\s\\S]*?)(</Array>)`), (_all, open: string, body: string, close: string) => {
      const point = body.match(/<mxPoint\b[^>]*\/>/g)?.find((tag) => {
        const x = Number(/\bx="([^"]*)"/.exec(tag)?.[1] ?? 0);
        const y = Number(/\by="([^"]*)"/.exec(tag)?.[1] ?? 0);
        return Math.abs(x - fix.from.x) <= 1 && Math.abs(y - fix.from.y) <= 1;
      });
      if (point === undefined) return `${open}${body}${close}`;
      const replacement = fix.to === null ? "" : `<mxPoint x="${fix.to.x}" y="${fix.to.y}"/>`;
      return `${open}${body.replace(point, replacement)}${close}`;
    });
  }
  return out;
}

/** Shapes a report says to move: `move "id" (label) by +9 on y`. */
export function shapeMoves(messages: string[]): Array<{ shape: string; axis: "x" | "y"; by: number }> {
  return messages.flatMap((message) => {
    const match = /Fix it: line up the shapes .*: move "([^"]+)"(?: \([^)]*\))? by ([+-]?\d+) on (x|y)/.exec(message);
    return match ? [{ shape: match[1]!, by: Number(match[2]), axis: match[3] as "x" | "y" }] : [];
  });
}

export function applyShapeMoves(xml: string, moves: Array<{ shape: string; axis: "x" | "y"; by: number }>): string {
  let out = xml;
  for (const move of moves) {
    const escaped = move.shape.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(<mxCell\\b[^>]*\\bid="${escaped}"[^>]*>\\s*<mxGeometry\\b[^>]*?\\b${move.axis}=")(-?[\\d.]+)`), (_all, head: string, value: string) => `${head}${Number(value) + move.by}`);
  }
  return out;
}

/** The wires a report says to remove all the waypoints of, and gives no single one to fix. */
export function dropWaypoints(messages: string[]): Set<string> {
  return new Set(messages.flatMap((message) => {
    const match = /^connector "([^"]+)".*Fix it: remove its waypoints/.exec(message);
    return match ? [match[1]!] : [];
  }));
}

export function stripWaypoints(xml: string, ids: Set<string>): string {
  let out = xml;
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(<mxCell\\b[^>]*\\bid="${escaped}"[\\s\\S]*?)<Array as="points">[\\s\\S]*?</Array>`), "$1");
  }
  return out;
}

export function apply(xml: string, changes: Map<string, Record<string, string>>): string {
  return xml.replace(/<mxCell\b[^>]*>/g, (tag) => {
    const id = /\bid="([^"]*)"/.exec(tag)?.[1];
    const change = id === undefined ? undefined : changes.get(id);
    if (!change) return tag;
    return tag.replace(/\bstyle="([^"]*)"/, (_all, style: string) => {
      let next = style;
      for (const [key, value] of Object.entries(change)) next = setStyle(next, key, value);
      return `style="${next}"`;
    });
  });
}

export const ANCHOR = /at the same point|facing away|runs .* units to join|runs through its (source|target)|needless bend/;

export interface FollowResult {
  rounds: number;
  /** True when no anchor warning is left; false when the advice ran dry or went round. */
  converged: boolean;
  looped: boolean;
  /** The anchor warnings left at the end. */
  left: string[];
  xml: string;
}

export function followAdvice(start: string, maxRounds = 12, onRound?: (round: number, anchors: string[]) => void): FollowResult {
  let xml = start;
  const seen = new Set<string>();
  for (let rounds = 0; ; rounds++) {
    const messages = checkDrawio(xml).issues.map((issue) => issue.message);
    const anchors = messages.filter((message) => ANCHOR.test(message));
    onRound?.(rounds, anchors);
    const changes = advice(messages);
    const fixes = waypointFixes(messages);
    const drop = dropWaypoints(messages);
    const moves = shapeMoves(messages);
    if (changes.size === 0 && drop.size === 0 && fixes.length === 0 && moves.length === 0) return { rounds, converged: anchors.length === 0, looped: false, left: anchors, xml };
    const next = applyShapeMoves(applyWaypointFixes(stripWaypoints(apply(xml, changes), drop), fixes), moves);
    if (next === xml || seen.has(next) || rounds >= maxRounds) return { rounds, converged: false, looped: true, left: anchors, xml };
    seen.add(xml);
    xml = next;
  }
}
