/**
 * The editor's git gutter, as in VS Code: a bar beside each line added or changed since
 * HEAD, a mark where lines were removed, worked out live against what the editor holds —
 * the draft as it is typed, not the file as saved.
 *
 * A click on a mark opens, under the change, what HEAD had there; an editable editor
 * also offers to put it back. Reverting only changes the draft: nothing is saved.
 *
 * The diff is by whole lines. A character diff (what `@codemirror/merge` chunks are
 * built from) counts deleting the last line as changing the one before it, since the
 * line break it removes ends that line. Each distinct line is given one character and
 * the package's Myers diff runs on those strings, so a change is always a run of lines.
 */
import { diff } from "@codemirror/merge";
import { RangeSet, StateEffect, StateField, Text, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, GutterMarker, WidgetType, gutter } from "@codemirror/view";

/** One run of changed lines: HEAD's `[fromA, toA)` became the document's `[fromB, toB)`, zero-based. */
export interface Hunk {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

export type HunkKind = "added" | "modified" | "deleted";

export function hunkKind(hunk: Hunk): HunkKind {
  if (hunk.fromA === hunk.toA) return "added";
  if (hunk.fromB === hunk.toB) return "deleted";
  return "modified";
}

/** A text's lines, whichever terminator ends them: HEAD's blob has LF, a Windows checkout CRLF. */
export function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Character codes for lines, skipping the surrogate range so every line is one code
 * unit. Past that many distinct lines the gutter is not drawn rather than drawn wrong.
 */
const FIRST_CODE = 0x100;
const LAST_CODE = 0xffff;
const SURROGATES = 0xdfff - 0xd800 + 1;
const MAX_DISTINCT_LINES = LAST_CODE - FIRST_CODE + 1 - SURROGATES;

function codeFor(index: number): string {
  const code = FIRST_CODE + index;
  return String.fromCharCode(code >= 0xd800 ? code + SURROGATES : code);
}

/** The runs of lines that differ between HEAD's lines and the document's, in order; null when the files are too varied to compare. */
export function lineHunks(baseline: readonly string[], document: readonly string[]): Hunk[] | null {
  const codes = new Map<string, string>();
  const encode = (lines: readonly string[]): string | null => {
    let out = "";
    for (const line of lines) {
      let code = codes.get(line);
      if (code === undefined) {
        if (codes.size >= MAX_DISTINCT_LINES) return null;
        code = codeFor(codes.size);
        codes.set(line, code);
      }
      out += code;
    }
    return out;
  };
  const a = encode(baseline);
  const b = encode(document);
  if (a === null || b === null) return null;
  return diff(a, b).map(({ fromA, toA, fromB, toB }) => ({ fromA, toA, fromB, toB }));
}

/**
 * The edit that puts a hunk back as HEAD had it, in document positions. Lines are
 * inserted as a `Text`, so the editor's own line separator (CRLF for a CRLF file) is kept.
 */
export function revertChange(doc: Text, baseline: readonly string[], hunk: Hunk): { from: number; to: number; insert: Text } {
  const old = baseline.slice(hunk.fromA, hunk.toA);
  if (hunk.fromB === hunk.toB) {
    // Lines removed: put them back before the line that now follows them, or after the last.
    if (hunk.fromB < doc.lines) {
      const at = doc.line(hunk.fromB + 1).from;
      return { from: at, to: at, insert: Text.of([...old, ""]) };
    }
    return { from: doc.length, to: doc.length, insert: Text.of(["", ...old]) };
  }
  let from = doc.line(hunk.fromB + 1).from;
  let to = doc.line(hunk.toB).to;
  if (old.length === 0) {
    // Lines added: remove them with one of the line breaks around them.
    if (hunk.toB < doc.lines) to = doc.line(hunk.toB + 1).from;
    else if (hunk.fromB > 0) from = doc.line(hunk.fromB).to;
    return { from, to, insert: Text.empty };
  }
  return { from, to, insert: Text.of(old) };
}

interface GutterState {
  baseline: string[] | null;
  hunks: Hunk[];
  /** The hunk whose HEAD text is shown under it, by index into `hunks`. */
  open: number | null;
}

/** HEAD's text for the gutter to compare with, or null to draw none. */
export const setGitBaseline = StateEffect.define<string | null>();
const togglePeek = StateEffect.define<number>();

function documentLines(doc: Text): string[] {
  const lines: string[] = [];
  for (const iter = doc.iterLines(); !iter.next().done; ) lines.push(iter.value);
  return lines;
}

function compare(baseline: string[] | null, doc: Text): Hunk[] {
  return baseline === null ? [] : (lineHunks(baseline, documentLines(doc)) ?? []);
}

/** The hunk at the same place after an edit, so an open peek stays open while typing elsewhere. */
function sameHunk(previous: Hunk, hunks: readonly Hunk[]): number | null {
  const index = hunks.findIndex((hunk) => hunk.fromA === previous.fromA && hunk.toA === previous.toA);
  return index === -1 ? null : index;
}

const gutterField = StateField.define<GutterState>({
  create: () => ({ baseline: null, hunks: [], open: null }),
  update(value, transaction) {
    let { baseline, hunks, open } = value;
    let rebuilt = false;
    for (const effect of transaction.effects) {
      if (effect.is(setGitBaseline)) {
        baseline = effect.value === null ? null : linesOf(effect.value);
        open = null;
        rebuilt = true;
      }
    }
    if (rebuilt || (transaction.docChanged && baseline !== null)) {
      const previous = open === null ? undefined : hunks[open];
      hunks = compare(baseline, transaction.state.doc);
      open = previous === undefined ? null : sameHunk(previous, hunks);
    }
    for (const effect of transaction.effects) {
      if (effect.is(togglePeek)) open = open === effect.value ? null : effect.value;
    }
    return baseline === value.baseline && hunks === value.hunks && open === value.open ? value : { baseline, hunks, open };
  },
});

class ChangeMarker extends GutterMarker {
  readonly kind: HunkKind;
  readonly index: number;
  /** A removal after the last line is marked at that line's foot rather than its head. */
  readonly atEnd: boolean;
  constructor(kind: HunkKind, index: number, atEnd = false) {
    super();
    this.kind = kind;
    this.index = index;
    this.atEnd = atEnd;
  }
  eq(other: ChangeMarker): boolean {
    return other.kind === this.kind && other.index === this.index && other.atEnd === this.atEnd;
  }
  toDOM(view: EditorView): HTMLElement {
    const mark = document.createElement("div");
    mark.className = `cm-git-mark cm-git-${this.kind}${this.atEnd ? " cm-git-at-end" : ""}`;
    mark.dataset.gitChange = this.kind;
    mark.title = {
      added: "Added since HEAD: click to see the change",
      modified: "Changed since HEAD: click to see what was there",
      deleted: "Lines removed since HEAD: click to see them",
    }[this.kind];
    // The mark fills its cell and answers the click itself: the gutter's own handler
    // finds the line from the pointer's height, which says nothing without a layout.
    mark.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ effects: togglePeek.of(this.index) });
    });
    return mark;
  }
}

function markers(state: EditorState): RangeSet<GutterMarker> {
  const { hunks } = state.field(gutterField);
  const doc = state.doc;
  const ranges = [];
  for (const [index, hunk] of hunks.entries()) {
    const kind = hunkKind(hunk);
    if (kind === "deleted") {
      const atEnd = hunk.fromB >= doc.lines;
      ranges.push(new ChangeMarker(kind, index, atEnd).range(doc.line(atEnd ? doc.lines : hunk.fromB + 1).from));
      continue;
    }
    for (let line = hunk.fromB; line < hunk.toB; line++) ranges.push(new ChangeMarker(kind, index).range(doc.line(line + 1).from));
  }
  return RangeSet.of(ranges, true);
}

class PeekWidget extends WidgetType {
  readonly index: number;
  readonly kind: HunkKind;
  readonly old: readonly string[];
  readonly editable: boolean;
  constructor(index: number, kind: HunkKind, old: readonly string[], editable: boolean) {
    super();
    this.index = index;
    this.kind = kind;
    this.old = old;
    this.editable = editable;
  }
  eq(other: PeekWidget): boolean {
    return other.index === this.index && other.editable === this.editable && other.old.join("\n") === this.old.join("\n");
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-git-peek";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "HEAD version of this change");
    const bar = document.createElement("div");
    bar.className = "cm-git-peek-bar";
    const title = document.createElement("span");
    title.textContent = this.kind === "added" ? "Not in HEAD" : "In HEAD";
    bar.append(title);
    if (this.editable) {
      const revert = document.createElement("button");
      revert.type = "button";
      revert.textContent = "Revert this change";
      revert.addEventListener("click", () => {
        const { baseline, hunks } = view.state.field(gutterField);
        const hunk = hunks[this.index];
        if (baseline === null || hunk === undefined) return;
        view.dispatch({ changes: revertChange(view.state.doc, baseline, hunk), userEvent: "input.revert" });
        view.focus();
      });
      bar.append(revert);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => view.dispatch({ effects: togglePeek.of(this.index) }));
    bar.append(close);
    box.append(bar);
    if (this.old.length > 0) {
      const code = document.createElement("pre");
      code.className = "cm-git-peek-old";
      code.textContent = this.old.join("\n");
      box.append(code);
    }
    return box;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function peekDecorations(state: EditorState): DecorationSet {
  const value = state.field(gutterField);
  if (value.open === null || value.baseline === null) return Decoration.none;
  const hunk = value.hunks[value.open];
  if (hunk === undefined) return Decoration.none;
  const doc = state.doc;
  const kind = hunkKind(hunk);
  const old = value.baseline.slice(hunk.fromA, hunk.toA);
  const widget = new PeekWidget(value.open, kind, old, !state.readOnly);
  // Under the changed lines; for a removal, where the lines were.
  const below = kind !== "deleted";
  const line = below ? doc.line(hunk.toB) : hunk.fromB < doc.lines ? doc.line(hunk.fromB + 1) : doc.line(doc.lines);
  const after = below || hunk.fromB >= doc.lines;
  return Decoration.set(Decoration.widget({ widget, block: true, side: after ? 1 : -1 }).range(after ? line.to : line.from));
}

/** The gutter and its peek. Inert until `setGitBaseline` gives it HEAD's text. */
export function gitGutter(): Extension {
  return [
    gutterField,
    // Block widgets must come from a facet computed from state, not from a view plugin.
    EditorView.decorations.compute([gutterField], peekDecorations),
    gutter({
      class: "cm-git-gutter",
      markers: (view) => markers(view.state),
      lineMarkerChange: (update) => update.startState.field(gutterField) !== update.state.field(gutterField),
    }),
  ];
}
