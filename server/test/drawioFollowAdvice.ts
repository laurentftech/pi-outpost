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
    // Detour: `fix its exit and entry on those sides (exitX=…;exitY=…;entryX=…;entryY=…)`
    const detour = /^connector "([^"]+)".*fix its exit and entry on those sides \(((?:(?:exit|entry)[XY]=[\d.]+;?)+)\)/.exec(message);
    if (detour) put(detour[1]!, detour[2]!);
    // Shared run: `move its exit to exitY=0.25 (keeping exitX=1)`
    const runEnd = /Fix "([^"]+)"(?: \([^)]*\))?: move its (?:exit|entry) to ((?:exit|entry)[XY]=[\d.]+) \(keeping ((?:exit|entry)[XY]=[\d.]+)\)/.exec(message);
    if (runEnd) put(runEnd[1]!, `${runEnd[2]};${runEnd[3]}`);
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

/** All of a wire's waypoints replaced: `Fix "id": move its waypoints to (x, y), (x, y)`. */
export function waypointSets(messages: string[]): Array<{ wire: string; points: Array<{ x: number; y: number }> }> {
  return messages.flatMap((message) => {
    const match = /Fix "([^"]+)"(?: \([^)]*\))?: (?:move its waypoints to|add waypoints at) ((?:\(-?\d+, -?\d+\)(?:, )?)+)/.exec(message);
    if (!match) return [];
    return [{ wire: match[1]!, points: [...match[2]!.matchAll(/\((-?\d+), (-?\d+)\)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })) }];
  });
}

export function applyWaypointSets(xml: string, sets: Array<{ wire: string; points: Array<{ x: number; y: number }> }>): string {
  let out = xml;
  for (const set of sets) {
    const escaped = set.wire.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const list = set.points.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join("");
    const withArray = new RegExp(`(<mxCell\\b[^>]*\\bid="${escaped}"[^>]*>\\s*<mxGeometry\\b[^>]*>[\\s\\S]*?<Array as="points">)[\\s\\S]*?(</Array>)`);
    out = withArray.test(out)
      ? out.replace(withArray, (_all, open: string, close: string) => `${open}${list}${close}`)
      : applyAddedArray(out, set.wire, list);
  }
  return out;
}

export function waypointFixes(messages: string[]): WaypointFix[] {
  return messages.flatMap((message) => {
    const runWire = /Fix "([^"]+)"(?: \([^)]*\))?: move its waypoint at/.exec(message)?.[1];
    const wire = runWire ?? /^connector "([^"]+)"/.exec(message)?.[1];
    if (wire === undefined) return [];
    const move = /(?:Fix it|Fix "[^"]+"(?: \([^)]*\))?): move its waypoint at \((-?\d+), (-?\d+)\) to \((-?\d+), (-?\d+)\)/.exec(message);
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

/** Label moves: `set x="0.3" in the mxGeometry of "id"`. */
export function labelMoves(messages: string[]): Array<{ cell: string; x: string; y?: string }> {
  return messages.flatMap((message) => {
    const match = /set x="(-?[\d.]+)"(?: y="(-?[\d.]+)")? in the mxGeometry of "([^"]+)"/.exec(message);
    return match ? [{ cell: match[3]!, x: match[1]!, ...(match[2] === undefined ? {} : { y: match[2] }) }] : [];
  });
}

export function applyLabelMoves(xml: string, moves: Array<{ cell: string; x: string; y?: string }>): string {
  let out = xml;
  for (const move of moves) {
    const escaped = move.cell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(<mxCell\\b[^>]*\\bid="${escaped}"[^>]*>\\s*<mxGeometry\\b)([^>]*?)(/?>)`), (_all, head: string, attributes: string, close: string) => {
      const set = (text: string, key: string, value: string) => (new RegExp(`\\b${key}="[^"]*"`).test(text) ? text.replace(new RegExp(`\\b${key}="[^"]*"`), `${key}="${value}"`) : `${text} ${key}="${value}"`);
      let next = set(attributes, "x", move.x);
      if (move.y !== undefined) next = set(next, "y", move.y);
      return `${head}${next}${close}`;
    });
  }
  return out;
}

function applyAddedArray(xml: string, wire: string, list: string): string {
  const escaped = wire.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.replace(new RegExp(`(<mxCell\\b[^>]*\\bid="${escaped}"[^>]*>\\s*<mxGeometry\\b[^>]*?)(/>|>)`), (_all, head: string, close: string) => (close === "/>" ? `${head}><Array as="points">${list}</Array></mxGeometry>` : `${head}><Array as="points">${list}</Array>`));
}

/** Waypoints to add to a wire that has none: `Fix "id": add a waypoint at (x, y)`. */
export function addedWaypoints(messages: string[]): Array<{ wire: string; at: { x: number; y: number } }> {
  return messages.flatMap((message) => {
    const match = /Fix "([^"]+)"(?: \([^)]*\))?: add a waypoint at \((-?\d+), (-?\d+)\)/.exec(message);
    return match ? [{ wire: match[1]!, at: { x: Number(match[2]), y: Number(match[3]) } }] : [];
  });
}

export function applyAddedWaypoints(xml: string, adds: Array<{ wire: string; at: { x: number; y: number } }>): string {
  let out = xml;
  for (const add of adds) {
    const escaped = add.wire.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const point = `<Array as="points"><mxPoint x="${add.at.x}" y="${add.at.y}"/></Array>`;
    out = out.replace(new RegExp(`(<mxCell\\b[^>]*\\bid="${escaped}"[^>]*>\\s*<mxGeometry\\b[^>]*?)(/>|>)`), (_all, head: string, close: string) => (close === "/>" ? `${head}>${point}</mxGeometry>` : `${head}>${point}`));
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
    const match = /^connector "([^"]+)".*(?:Fix it: remove its waypoints|and remove its waypoints)/.exec(message);
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

export const ANCHOR = /at the same point|facing away|runs .* units to join|runs through its (source|target)|needless bend|lies on the label|lies across connector|run along the same line/;

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
    const labelled = labelMoves(messages);
    const adds = addedWaypoints(messages);
    const sets = waypointSets(messages);
    if (changes.size === 0 && drop.size === 0 && fixes.length === 0 && moves.length === 0 && labelled.length === 0 && adds.length === 0 && sets.length === 0) return { rounds, converged: anchors.length === 0, looped: false, left: anchors, xml };
    const next = applyWaypointSets(applyAddedWaypoints(applyLabelMoves(applyShapeMoves(applyWaypointFixes(stripWaypoints(apply(xml, changes), drop), fixes), moves), labelled), adds), sets);
    if (next === xml || seen.has(next) || rounds >= maxRounds) return { rounds, converged: false, looped: true, left: anchors, xml };
    seen.add(xml);
    xml = next;
  }
}
