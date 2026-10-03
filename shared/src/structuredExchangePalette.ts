/**
 * The colours a figure carries with it.
 *
 * In `shared` because a figure produced without a browser has to be the same picture
 * a reader sees, and colour is half of what "the same picture" means.
 */
import type { ChangeRole } from "./structuredExchangeModel.ts";

/* ── Palette ────────────────────────────────────────────────────────────────── */

/**
 * Explicit colours, and a ground to sit on.
 *
 * Attributes rather than classes, because a copied SVG carries its attributes and
 * leaves its stylesheet behind. One palette serves both themes: the diagram is a
 * figure with its own white ground, the way an exported chart is, rather than
 * something that changes with the page around it.
 */
export const PAPER = "#ffffff";
export const INK = "#27272a";
export const MUTED = "#71717a";

export const ROLE_PAINT: Record<ChangeRole, { fill: string; stroke: string; text: string }> = {
  added: { fill: "#ecfdf5", stroke: "#059669", text: "#065f46" },
  changed: { fill: "#fffbeb", stroke: "#d97706", text: "#92400e" },
  context: { fill: "#fafafa", stroke: "#d4d4d8", text: "#71717a" },
  unchanged: { fill: "#ffffff", stroke: "#a1a1aa", text: INK },
};

export const RELATIONSHIP_PAINT: Record<ChangeRole, string> = {
  added: "#059669",
  changed: "#d97706",
  context: "#d4d4d8",
  unchanged: "#a1a1aa",
};

export const ROLES: ChangeRole[] = ["added", "changed", "context", "unchanged"];

/**
 * Colour by type, emphasis by role.
 *
 * The contract carries a producer's own type for a thing — "block", "sensor",
 * "power", "thermal" — and never a colour. Presentation in the document would be
 * meaningless to whatever applies the proposal, which has its own styling, and it
 * would fight the one signal this view exists to carry: what is changing. So the
 * type picks the fill and the role can always override the outline.
 *
 * The assignment is a hash rather than a registry, so the same type draws the same
 * colour in every session and every diagram without anyone maintaining a mapping.
 * Nothing downstream depends on which colour a type gets, only that it is stable.
 */
const KIND_TINTS: { fill: string; stroke: string }[] = [
  { fill: "#eff6ff", stroke: "#2563eb" },
  { fill: "#f5f3ff", stroke: "#7c3aed" },
  { fill: "#ecfeff", stroke: "#0891b2" },
  { fill: "#fff1f2", stroke: "#e11d48" },
  { fill: "#f7fee7", stroke: "#65a30d" },
  { fill: "#fff7ed", stroke: "#ea580c" },
  { fill: "#f0fdfa", stroke: "#0d9488" },
  { fill: "#fdf4ff", stroke: "#c026d3" },
  { fill: "#fefce8", stroke: "#ca8a04" },
  { fill: "#f8fafc", stroke: "#475569" },
  { fill: "#eef2ff", stroke: "#4f46e5" },
  { fill: "#fef2f2", stroke: "#b91c1c" },
  { fill: "#f0fdf4", stroke: "#16a34a" },
  { fill: "#fdf2f8", stroke: "#db2777" },
  { fill: "#f5f5f4", stroke: "#78716c" },
  { fill: "#f0f9ff", stroke: "#0369a1" },
];

/**
 * A second channel, so colour is not the only thing telling two types apart.
 *
 * Sixteen colours against a contract that allows five hundred elements was a promise
 * that broke on real data, and the honest options were to widen the encoding or to
 * stop claiming it. Both, in the end: a dash pattern multiplies the distinguishable
 * presentations fourfold, and past that the key says colours repeat rather than
 * implying a distinctness that is not there. Nobody reads sixty-five types by eye
 * anyway — what has to hold beyond that point is that every type is *named*, in the
 * key and on hover.
 */
const KIND_DASHES: (string | undefined)[] = [undefined, "7 3", "2 3", "9 3 2 3"];

/**
 * How many types can be told apart by appearance alone.
 *
 * The contract bounds each vocabulary at exactly this number, so the two cannot
 * disagree: a document the rendering could not distinguish is refused rather than
 * drawn ambiguously. `STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary` is asserted
 * against it.
 */
export const KIND_PRESENTATIONS = KIND_TINTS.length * KIND_DASHES.length;

/** `declared`: the colour is the project's, not the palette's. */
export type Tint = { fill: string; stroke: string; dash?: string; declared?: boolean };

/** Colours a project declares for one vocabulary, by kind name. */
export type DeclaredColours = Readonly<Record<string, { color: string }>>;

/** A declared colour mixed toward white: the light fill a box or bar is painted with. */
export function lighten(color: string, amount = 0.88): string {
  const channel = (index: number) => {
    const value = Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16);
    return Math.round(value + (255 - value) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** FNV-1a, for a preferred slot that depends only on the name. */
function hashOf(kind: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < kind.length; index++) {
    hash ^= kind.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A colour per type, distinct within the diagram.
 *
 * The hash alone was wrong, and wrong in a way that only showed on real data: five
 * types drew in four colours, because five names into ten slots collide about seven
 * times in ten. Two types rendered identically while the key beside them insisted
 * they differed — worse than no colour at all, because it reads as information.
 *
 * So the hash picks a preferred slot and a taken slot probes forward. A name keeps
 * the same colour across documents when nothing contends for it, and two types in
 * one diagram are never the same colour until the palette is genuinely exhausted.
 * Distinctness wins the trade: stability across documents is a convenience, two
 * things that look alike and are not is a misreading.
 */
export const KIND_TINT_COUNT = KIND_TINTS.length;

export function assignTints(kinds: string[], declared?: DeclaredColours): Map<string, Tint> {
  const assigned = new Map<string, Tint>();
  const taken = new Set<number>();
  // The project's colours first, exactly as declared. An automatic colour equal to one
  // of them, in this drawing, would make two kinds look alike that the project told
  // apart — so those palette colours are withheld from the kinds it did not name.
  const ownColour = (kind: string) => (declared !== undefined && Object.hasOwn(declared, kind) ? declared[kind].color : undefined);
  const declaredHere = new Set<string>();
  for (const kind of kinds) {
    const color = ownColour(kind);
    if (color === undefined) continue;
    assigned.set(kind, { fill: lighten(color), stroke: color, declared: true });
    declaredHere.add(color.toLowerCase());
  }
  for (let slot = 0; slot < KIND_PRESENTATIONS; slot++) {
    if (declaredHere.has(KIND_TINTS[slot % KIND_TINTS.length].stroke.toLowerCase())) taken.add(slot);
  }
  for (const kind of kinds) {
    if (assigned.has(kind)) continue;
    let slot = hashOf(kind) % KIND_PRESENTATIONS;
    for (let probe = 0; probe < KIND_PRESENTATIONS && taken.has(slot); probe++) {
      slot = (slot + 1) % KIND_PRESENTATIONS;
    }
    taken.add(slot);
    const tint = KIND_TINTS[slot % KIND_TINTS.length];
    assigned.set(kind, { ...tint, dash: KIND_DASHES[Math.floor(slot / KIND_TINTS.length) % KIND_DASHES.length] });
  }
  return assigned;
}

/**
 * For each kind drawn in a declared colour, the other kinds here declared the same
 * colour. The project chose it, so neither is recoloured; the key says so instead.
 */
export function sharedDeclaredColours(kinds: string[], tints: ReadonlyMap<string, Tint>): Map<string, string[]> {
  const byColour = new Map<string, string[]>();
  for (const kind of kinds) {
    const tint = tints.get(kind);
    if (tint?.declared !== true) continue;
    const key = tint.stroke.toLowerCase();
    byColour.set(key, [...(byColour.get(key) ?? []), kind]);
  }
  const shared = new Map<string, string[]>();
  for (const group of byColour.values()) {
    if (group.length < 2) continue;
    for (const kind of group) shared.set(kind, group.filter((other) => other !== kind));
  }
  return shared;
}

/** The types present, in the order they first appear, so the legend is stable too. */
export function kindsPresent(things: { kind?: string }[]): string[] {
  const seen: string[] = [];
  for (const thing of things) {
    if (thing.kind !== undefined && thing.kind !== "" && !seen.includes(thing.kind)) seen.push(thing.kind);
  }
  return seen;
}
