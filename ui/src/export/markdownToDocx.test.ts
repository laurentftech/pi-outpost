import { describe, expect, it } from "vitest";
import type { Root, RootContent } from "mdast";
import { parseMarkdown } from "./markdownToDocx";

/** Every node of a type, anywhere in the tree. */
function nodesOfType(root: Root, type: string): RootContent[] {
  const found: RootContent[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    if (node.type === type) found.push(node as RootContent);
    for (const child of (node.children ?? []) as { type: string; children?: unknown[] }[]) walk(child);
  };
  walk(root);
  return found;
}

/** The `value` a math node carries — the LaTeX the transform will be handed. */
function mathValue(node: RootContent): string {
  return (node as unknown as { value: string }).value;
}

describe("parseMarkdown", () => {
  it("tells an inline equation from a display one", () => {
    // The whole equation mapping rests on this distinction: an inline equation stays
    // inside its paragraph, a display equation becomes its own block. If the parser
    // did not separate them, nothing downstream could.
    const tree = parseMarkdown("Mass is $E = mc^2$ here.\n\n$$\n\\int_0^1 x\\,dx\n$$\n");

    const inline = nodesOfType(tree, "inlineMath");
    const display = nodesOfType(tree, "math");
    expect(inline).toHaveLength(1);
    expect(display).toHaveLength(1);
    expect(mathValue(inline[0])).toBe("E = mc^2");
    expect(mathValue(display[0])).toBe("\\int_0^1 x\\,dx");
  });

  it("hands the LaTeX on untouched, backslashes and all", () => {
    // What reaches KaTeX must be what the author wrote. A parser that processed
    // escapes inside math would turn every command into a word — `\int` into `int` —
    // and every equation in the document would silently typeset as nonsense.
    const tree = parseMarkdown("$$\n\\frac{\\alpha}{\\beta} \\, \\sqrt{x}\n$$\n");

    expect(mathValue(nodesOfType(tree, "math")[0])).toBe("\\frac{\\alpha}{\\beta} \\, \\sqrt{x}");
  });

  it("reads a one-line $$…$$ as inline, the way the viewer does", () => {
    // Not the arrangement one might expect, and deliberately not corrected here:
    // remark-math only opens a display block for a fenced `$$` on its own line, so a
    // one-liner is inline math with a two-character delimiter. The viewer renders it
    // that way already; an export that decided otherwise would disagree with the
    // page the reader was looking at when they asked for it.
    const tree = parseMarkdown("$$a^2 + b^2 = c^2$$\n");

    expect(nodesOfType(tree, "math")).toHaveLength(0);
    expect(nodesOfType(tree, "inlineMath")).toHaveLength(1);
  });

  it("normalises the delimiters the renderer normalises, before parsing", () => {
    // Models emit \(…\) and \[…\]; the viewer rewrites them before rendering. An
    // export that skipped this step would show equations on screen and literal
    // backslashes in Word, from the very same text.
    const tree = parseMarkdown("Energy \\(E = mc^2\\) and \\[a^2 + b^2 = c^2\\] too.\n");

    // Both arrive as math rather than as literal text. They are both *inline*
    // because the normaliser writes `\[…\]` as a one-line `$$…$$`, which the rule
    // above then reads as inline — the viewer has the same quirk, and this test
    // records it rather than papering over it.
    expect(nodesOfType(tree, "inlineMath")).toHaveLength(2);
  });

  it("reads a dollar pair as math, the way the viewer does", () => {
    // remark-math has no "no digit after the opening dollar" rule, so a price and a
    // later bare dollar pair up. Recorded, not fixed: this is the renderer's
    // behaviour, and the export exists to agree with the renderer.
    const tree = parseMarkdown("It costs $5 and the prompt is $ here.\n");

    expect(nodesOfType(tree, "inlineMath")).toHaveLength(1);
  });

  it("reads GFM tables and strikethrough, which plain markdown does not", () => {
    const tree = parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~\n");

    expect(nodesOfType(tree, "table")).toHaveLength(1);
    expect(nodesOfType(tree, "tableRow")).toHaveLength(2);
    expect(nodesOfType(tree, "delete")).toHaveLength(1);
  });

  it("does not read math or tables inside a code fence", () => {
    // A fence is a quotation of source, not content: an example of markdown in a
    // README must survive the export as the example it is.
    const tree = parseMarkdown("```\n| a | b |\n$x^2$\n```\n");

    expect(nodesOfType(tree, "table")).toHaveLength(0);
    expect(nodesOfType(tree, "inlineMath")).toHaveLength(0);
    expect(nodesOfType(tree, "code")).toHaveLength(1);
  });
});
