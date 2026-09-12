/**
 * How much room text takes, decided by counting rather than by measuring.
 *
 * `CHAR_WIDTH` is a constant and every width here is arithmetic on it. Nothing calls
 * `measureText`, reads a computed style, or asks a layout engine how wide a string
 * came out — which is exactly why the same numbers come out under Node as in a
 * browser, and why a figure produced for the agent is the reader's picture rather
 * than an approximation of it.
 *
 * Native SVG does not wrap text. `wrapLabel` is what a portable diagram costs.
 */
// Types only: they erase, so `model` may import this module back without a runtime
// cycle. `elementSummary` used to live here and needed values from it, which is why
// it now lives there.
import type { FieldChange } from "./structuredExchangeModel.ts";

/* ── Text measurement and wrapping ──────────────────────────────────────────── */

export const CHAR_WIDTH = 6.6;
/** Changes are printed two points smaller than the label above them. */
export const CHANGE_CHAR_WIDTH = 5.4;
export const BOX_PADDING = 22;
export const LINE_HEIGHT = 15;
export const BOX_VERTICAL_PADDING = 14;
export const MAX_LINES = 3;

export function boxWidth(labels: string[], min: number, max: number): number {
  const longest = labels
    .flatMap((label) => label.split(/\r?\n/))
    .reduce((widest, line) => Math.max(widest, line.length), 0);
  return Math.min(Math.max(longest * CHAR_WIDTH + BOX_PADDING, min), max);
}

/**
 * A box wide enough for everything printed in it, not only its name.
 *
 * A change is printed inside the box, in smaller type, and reads "label: before →
 * after" — routinely longer than the name above it. Sized on the name alone, a
 * renamed participant showed "label: Onboard Charger → OBC (11" and stopped at the
 * border, which reads as a truncated value rather than a missing box.
 */
export function boxWidthWithChanges(
  labels: string[],
  changes: FieldChange[],
  min: number,
  max: number,
): number {
  const longestChange = changes
    .map((change) => changeText(change).length)
    .reduce((widest, length) => Math.max(widest, length), 0);
  return Math.max(
    boxWidth(labels, min, max),
    Math.min(longestChange * CHANGE_CHAR_WIDTH + BOX_PADDING, max),
  );
}

/**
 * Break a label into lines that fit, by hand.
 *
 * HTML wrapped text for free; native SVG does not, and this is what a portable
 * diagram costs. Words stay whole where they fit, a word longer than the line is
 * broken rather than allowed to overflow, and a label too long for its lines ends
 * in an ellipsis — the full text is on the element's `title`, so nothing is lost,
 * only deferred to a hover.
 */
export function wrapLabel(label: string, width: number, charWidth: number = CHAR_WIDTH): string[] {
  // The epsilon is not decoration: a box sized for exactly n characters computes
  // n - 1e-15 here, and floor then wraps a line that fits, one character short.
  const perLine = Math.max(Math.floor((width - BOX_PADDING) / charWidth + 1e-6), 4);
  const lines: string[] = [];
  // An explicit newline is a break the producer asked for — a name and the thing
  // that qualifies it. Reflowing the two into one paragraph loses what they meant.
  const paragraphs = label.split(/\r?\n/);
  if (paragraphs.length > 1) {
    return paragraphs
      .flatMap((paragraph) => wrapLabel(paragraph, width, charWidth))
      .slice(0, MAX_LINES);
  }
  let current = "";
  for (const word of label.split(/\s+/)) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = word;
    while (current.length > perLine && lines.length < MAX_LINES) {
      lines.push(current.slice(0, perLine));
      current = current.slice(perLine);
    }
  }
  if (current !== "") lines.push(current);
  if (lines.length === 0) return [""];
  if (lines.length <= MAX_LINES) return lines;
  const kept = lines.slice(0, MAX_LINES);
  kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1].slice(0, Math.max(perLine - 1, 1))}…`;
  return kept;
}

export function boxHeight(lines: number, changes: number): number {
  return lines * LINE_HEIGHT + changes * LINE_HEIGHT + BOX_VERTICAL_PADDING;
}

/**
 * The lines a set of changes takes inside a box of this width.
 *
 * A change reads "label: before → after" and is routinely longer than the name above
 * it. Left on one line it stopped at the border, showing "… → OBC (11" — which reads
 * as a truncated value rather than as a box too small for it. Widening the box
 * without bound is the other wrong answer, so it wraps, as the label already does.
 */
export function changeLines(changes: FieldChange[], width: number): string[] {
  return changes.flatMap((change) => wrapLabel(changeText(change), width, CHANGE_CHAR_WIDTH));
}

/** One change, written the way a reader needs to see it. */
export function changeText(change: FieldChange): string {
  return `${change.field}: ${change.from === undefined ? "" : `${change.from} → `}${change.to}`;
}


/**
 * One attribute, as a reader meets it.
 *
 * A reference is shown as the identifier it is, in angle brackets, rather than as
 * the bare string: a value that happens to read like a label would otherwise be
 * indistinguishable from one, and the difference is exactly what a reference is
 * for. A list is joined rather than bulleted, because these lines are read in a
 * sentence and a list of three things is not a document structure.
 */
export function attributeText(name: string, value: unknown): string {
  return `${name}: ${attributeValueText(value)}`;
}

export function attributeValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => attributeValueText(entry)).join(", ");
  if (value === null) return "null";
  if (value !== null && typeof value === "object" && typeof (value as { ref?: unknown }).ref === "string") {
    return `<${(value as { ref: string }).ref}>`;
  }
  return String(value);
}

/** Where something can be found, with the range when it names one. */
export function locationText(location: {
  uri: string;
  revision?: string;
  range?: { startLine: number; endLine: number };
}): string {
  const range = location.range === undefined ? "" : ` lines ${location.range.startLine}–${location.range.endLine}`;
  const revision = location.revision === undefined ? "" : ` at ${location.revision}`;
  return `${location.uri}${range}${revision}`;
}

/**
 * An artifact link, digest included.
 *
 * The digest is shortened for reading and never hidden: it is what an approval is
 * bound to, so a reader who cannot see that one is present cannot tell a link that
 * will be verified from one that will not.
 */
export function artifactText(artifact: {
  rel: string;
  uri: string;
  sha256: string;
  mediaType?: string;
  label?: string;
}): string {
  const named = artifact.label === undefined ? artifact.uri : `${artifact.label} (${artifact.uri})`;
  const type = artifact.mediaType === undefined ? "" : `, ${artifact.mediaType}`;
  return `${artifact.rel}: ${named}${type} — ${artifact.sha256.slice(0, 14)}…`;
}
