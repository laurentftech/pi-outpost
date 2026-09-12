/**
 * The direction a Mermaid source states, and the same source stating the other one.
 *
 * A Mermaid diagram is not laid out here: it is a string the model wrote, handed to a
 * library that lays it out. The only way to draw it the other way round is to change
 * the direction in the source before handing it over — mermaid has no API for "lay
 * this out again, differently", because direction is part of the diagram definition.
 *
 * So this rewrites, narrowly and reversibly, and it never touches what the reader is
 * shown: the source under `⌗ code` and behind the copy button stays the authored one.
 * Presenting a rewritten source as the agent's own words would be this application
 * quietly putting words in its mouth.
 *
 * What is deliberately not recognised is everything else. A notation with no direction
 * of its own — a sequence, a pie, a gantt, a class diagram — has no orientation to
 * choose, and a header this does not understand is left exactly as written. The cost
 * of not recognising something is that the reader gets today's behaviour; the cost of
 * guessing wrong is a diagram that no longer renders.
 */

import type { Orientation } from "@pi-outpost/shared/diagram-orientation";

/** The four directions Mermaid's flow-like notations take. */
export type MermaidDirection = "LR" | "RL" | "TB" | "BT";

const ACROSS: MermaidDirection[] = ["LR", "RL"];

/** Which way a diagram drawn in this direction runs. */
export function orientationOfDirection(direction: MermaidDirection): Orientation {
  return ACROSS.includes(direction) ? "landscape" : "portrait";
}

/**
 * The direction that turns this one a quarter turn, keeping which end it starts from.
 *
 * `LR` becomes `TB` rather than `BT`: a diagram read left to right reads top to
 * bottom, and flipping the start as well would reverse the reader's sense of the flow
 * on top of turning it.
 */
export function turnedDirection(direction: MermaidDirection): MermaidDirection {
  switch (direction) {
    case "LR":
      return "TB";
    case "TB":
      return "LR";
    case "RL":
      return "BT";
    case "BT":
      return "RL";
  }
}

/** `TD` is Mermaid's own synonym for `TB`, and appears in about half the sources. */
function normalize(token: string): MermaidDirection | undefined {
  const upper = token.toUpperCase();
  if (upper === "TD") return "TB";
  return upper === "TB" || upper === "BT" || upper === "LR" || upper === "RL" ? upper : undefined;
}

/**
 * Lines that come before the diagram itself: YAML frontmatter, `%%{init}%%`
 * directives, comments and blank lines.
 *
 * Skipped rather than parsed. A source that opens with a theme directive is ordinary,
 * and treating the directive as the header would have meant refusing to orient every
 * diagram the model styled.
 */
function headerIndex(lines: string[]): number {
  let index = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, at) => at > 0 && line.trim() === "---");
    if (close === -1) return -1;
    index = close + 1;
  }
  for (; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "" || line.startsWith("%%")) continue;
    return index;
  }
  return -1;
}

export interface OrientableMermaid {
  /** The direction the source is drawn in as written. */
  direction: MermaidDirection;
  /** The same source, drawn the other way. */
  turned: string;
}

/**
 * How this source is oriented, and how to state the other orientation — or undefined
 * when the notation has no direction to choose or is not one this understands.
 */
export function orientableMermaid(code: string): OrientableMermaid | undefined {
  const lines = code.split("\n");
  const at = headerIndex(lines);
  if (at === -1) return undefined;
  const header = lines[at]!;

  const flow = /^(\s*)(flowchart|graph)([ \t]+(TD|TB|BT|LR|RL)\b)?(.*)$/i.exec(header);
  if (flow !== null) {
    const [, indent, keyword, , stated, rest] = flow;
    // No direction stated is not "no direction": mermaid draws a bare `flowchart`
    // top to bottom, so that is what turning it has to be turning away from.
    const direction = stated === undefined ? ("TB" as const) : normalize(stated)!;
    const turned = turnedDirection(direction);
    const rewritten = [...lines];
    rewritten[at] = `${indent}${keyword} ${turned}${rest}`;
    return { direction, turned: rewritten.join("\n") };
  }

  const state = /^(\s*)stateDiagram(-v2)?\s*$/i.exec(header);
  if (state !== null) return turnedStateDiagram(lines, at, state[1]!);

  return undefined;
}

/**
 * A state diagram states its direction in a statement rather than in its header, and
 * a nested `state ... { }` may state its own.
 *
 * Only the outermost one is this diagram's orientation; rewriting a nested one would
 * turn one composite state inside a diagram that stayed as it was. Depth is counted
 * on braces, which is how the notation nests.
 */
function turnedStateDiagram(lines: string[], at: number, indent: string): OrientableMermaid {
  let depth = 0;
  for (let index = at + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const declared = depth === 0 ? /^\s*direction\s+(TD|TB|BT|LR|RL)\s*$/i.exec(line) : null;
    if (declared !== null) {
      const direction = normalize(declared[1]!)!;
      const rewritten = [...lines];
      rewritten[index] = line.replace(/(direction\s+)(TD|TB|BT|LR|RL)/i, `$1${turnedDirection(direction)}`);
      return { direction, turned: rewritten.join("\n") };
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
    if (depth < 0) depth = 0;
  }
  // Nothing stated: the default is top to bottom, and turning it means saying so.
  const rewritten = [...lines];
  rewritten.splice(at + 1, 0, `${indent}    direction LR`);
  return { direction: "TB", turned: rewritten.join("\n") };
}
