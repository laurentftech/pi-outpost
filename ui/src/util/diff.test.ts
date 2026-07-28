import { describe, it, expect } from "vitest";
import { diffLines, toSideBySide, rowsWithContext, withContext } from "./diff";

describe("diffLines", () => {
  it("returns all same lines for identical text", () => {
    const result = diffLines("a\nb\nc", "a\nb\nc");
    expect(result.every((l) => l.type === "same")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("detects additions", () => {
    const result = diffLines("a\nc", "a\nb\nc");
    expect(result.find((l) => l.type === "add")?.text).toBe("b");
  });

  it("detects deletions", () => {
    const result = diffLines("a\nb\nc", "a\nc");
    expect(result.find((l) => l.type === "del")?.text).toBe("b");
  });

  it("handles empty old text", () => {
    const result = diffLines("", "a\nb");
    expect(result.filter((l) => l.type === "add")).toHaveLength(2);
  });

  it("handles empty new text", () => {
    const result = diffLines("a\nb", "");
    expect(result.filter((l) => l.type === "del")).toHaveLength(2);
  });

  it("handles completely different text", () => {
    const result = diffLines("abc", "xyz");
    expect(result.some((l) => l.type === "del")).toBe(true);
    expect(result.some((l) => l.type === "add")).toBe(true);
  });

  it("large diff degrades to all-del/all-add beyond CAP", () => {
    const bigA = Array.from({ length: 400 }, (_, i) => `line${i}`).join("\n");
    const bigB = Array.from({ length: 400 }, (_, i) => `LINE${i}`).join("\n");
    const result = diffLines(bigA, bigB);
    // Should have 400 del + 400 add (no same lines since all changed)
    expect(result.filter((l) => l.type === "del")).toHaveLength(400);
    expect(result.filter((l) => l.type === "add")).toHaveLength(400);
    expect(result.filter((l) => l.type === "same")).toHaveLength(0);
  });
});

describe("toSideBySide", () => {
  it("converts same lines to unchanged rows", () => {
    const lines = diffLines("a\nb", "a\nb");
    const rows = toSideBySide(lines);
    expect(rows.every((r) => !r.changed)).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("pairs del/add runs into aligned rows", () => {
    const lines = diffLines("a\nx\ny\nc", "a\nb\nc");
    const rows = toSideBySide(lines);
    const changed = rows.filter((r) => r.changed);
    expect(changed.length).toBeGreaterThan(0);
    // At least one deletion should have left: value and right: null
    expect(changed.some((r) => r.left !== null && r.right === null)).toBe(true);
  });
});

describe("rowsWithContext", () => {
  it("keeps context rows around changes", () => {
    const rows = [
      { left: "a", right: "a", changed: false },
      { left: "b", right: "b", changed: false },
      { left: "x", right: null, changed: true },
      { left: "y", right: "y", changed: false },
      { left: "z", right: "z", changed: false },
    ];
    const result = rowsWithContext(rows, 1);
    // Row 0 is outside context window of the change at index 2 → collapsed
    expect(result[0]).toBeNull();
    // Rows 1, 2, 3 within context → kept
    expect(result[1]).not.toBeNull();
    expect(result[2]).not.toBeNull();
    expect(result[3]).not.toBeNull();
  });

  it("inserts null separators for collapsed runs", () => {
    const rows = [
      { left: "a", right: "a", changed: false },
      { left: "unchanged1", right: "unchanged1", changed: false },
      { left: "unchanged2", right: "unchanged2", changed: false },
      { left: "unchanged3", right: "unchanged3", changed: false },
      { left: "x", right: null, changed: true },
    ];
    const result = rowsWithContext(rows, 1);
    // Should have separators (null) for the far-unchanged rows
    const nulls = result.filter((r) => r === null);
    expect(nulls.length).toBeGreaterThan(0);
  });
});

describe("withContext", () => {
  it("keeps context lines around changes", () => {
    const lines = [
      { type: "same" as const, text: "a" },
      { type: "same" as const, text: "b" },
      { type: "del" as const, text: "x" },
      { type: "add" as const, text: "y" },
      { type: "same" as const, text: "z" },
    ];
    const result = withContext(lines, 2);
    // All lines should be kept since they're within context of the change
    expect(result.filter((r) => r !== null)).toHaveLength(5);
  });

  it("inserts null separators", () => {
    const lines = [
      { type: "same" as const, text: "far" },
      { type: "same" as const, text: "away" },
      { type: "del" as const, text: "change" },
    ];
    const result = withContext(lines, 0);
    // Consecutive outside-context rows collapse to a single null separator
    expect(result[0]).toBeNull();
    // 'away' is skipped (consecutive non-kept)
    // 'change' is kept
    expect(result[1]).not.toBeNull();
  });
});
