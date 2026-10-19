import { EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { hunkKind, lineHunks, linesOf, revertChange } from "./gitGutter";

const lines = (text: string) => linesOf(text);

describe("lineHunks", () => {
  it("marks a changed line as modified, and nothing else", () => {
    const hunks = lineHunks(lines("a\nb\nc\nd"), lines("a\nB\nc\nd"));
    expect(hunks).toEqual([{ fromA: 1, toA: 2, fromB: 1, toB: 2 }]);
    expect(hunkKind(hunks![0]!)).toBe("modified");
  });

  it("counts deleting the last line as a removal, not a change of the line before", () => {
    const hunks = lineHunks(lines("a\nb\nc"), lines("a\nb"));
    expect(hunks).toEqual([{ fromA: 2, toA: 3, fromB: 2, toB: 2 }]);
    expect(hunkKind(hunks![0]!)).toBe("deleted");
  });

  // openlore: scenario=TwoDistantEditsStayApart spec=git
  it("TwoDistantEditsStayApart: two distant edits are two hunks, not everything between them", () => {
    const head = Array.from({ length: 2000 }, (_, index) => `line ${index}`);
    const edited = [...head];
    edited[10] = "changed near the top";
    edited[1900] = "changed near the bottom";
    expect(lineHunks(head, edited)).toEqual([
      { fromA: 10, toA: 11, fromB: 10, toB: 11 },
      { fromA: 1900, toA: 1901, fromB: 1900, toB: 1901 },
    ]);
  });

  it("compares a CRLF working copy with an LF blob line by line", () => {
    expect(lineHunks(lines("a\nb\n"), lines("a\r\nb\r\n"))).toEqual([]);
    expect(lineHunks(lines("a\nb\n"), lines("a\r\nB\r\n"))).toEqual([{ fromA: 1, toA: 2, fromB: 1, toB: 2 }]);
  });

  it("finds added lines at the start, in the middle and at the end", () => {
    expect(lineHunks(lines("b\nc"), lines("a\nb\nc")).map(hunkKind)).toEqual(["added"]);
    expect(lineHunks(lines("a\nc"), lines("a\nb\nc")).map(hunkKind)).toEqual(["added"]);
    expect(lineHunks(lines("a\nb"), lines("a\nb\nc")).map(hunkKind)).toEqual(["added"]);
  });
});

/** A seeded generator, so a failing case can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function editLines(source: string[], next: () => number): string[] {
  const out = [...source];
  const edits = 1 + Math.floor(next() * 4);
  for (let edit = 0; edit < edits; edit++) {
    const at = Math.floor(next() * (out.length + 1));
    const roll = next();
    if (roll < 0.33) out.splice(at, 0, `new ${Math.floor(next() * 1000)}`);
    else if (roll < 0.66 && out.length > 1) out.splice(Math.min(at, out.length - 1), 1);
    else if (out.length > 0) out[Math.min(at, out.length - 1)] = `edited ${Math.floor(next() * 1000)}`;
  }
  return out;
}

describe("revertChange", () => {
  it("puts every hunk back, from the last to the first, until the document is HEAD again", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = random(seed);
      const head = Array.from({ length: 1 + Math.floor(next() * 8) }, (_, index) => `line ${index}`);
      if (next() < 0.3) head.push("");
      const edited = editLines(head, next);
      let state = EditorState.create({ doc: edited.join("\n") });
      const hunks = lineHunks(head, edited)!;
      for (const hunk of [...hunks].reverse()) {
        state = state.update({ changes: revertChange(state.doc, head, hunk) }).state;
      }
      expect(state.doc.toString(), `seed ${seed}: ${JSON.stringify(edited)}`).toBe(head.join("\n"));
    }
  });

  it("keeps the editor's CRLF separator in the lines it puts back", () => {
    const state = EditorState.create({ doc: "a\r\nX\r\nc", extensions: EditorState.lineSeparator.of("\r\n") });
    const hunk = lineHunks(["a", "b1", "b2", "c"], ["a", "X", "c"])![0]!;
    const reverted = state.update({ changes: revertChange(state.doc, ["a", "b1", "b2", "c"], hunk) }).state;
    expect(reverted.sliceDoc()).toBe("a\r\nb1\r\nb2\r\nc");
  });

  it("restores lines removed from an empty document", () => {
    const state = EditorState.create({ doc: "" });
    const hunk = lineHunks(["x", "y"], [""])!;
    let next = state;
    for (const each of [...hunk].reverse()) next = next.update({ changes: revertChange(next.doc, ["x", "y"], each) }).state;
    expect(next.doc.toString()).toBe("x\ny");
    expect(Text.of(["x", "y"]).eq(next.doc)).toBe(true);
  });
});
