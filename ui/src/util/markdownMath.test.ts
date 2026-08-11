import { describe, it, expect } from "vitest";
import { normalizeMathDelimiters } from "./markdownMath";

describe("normalizeMathDelimiters", () => {
  it("returns text unchanged when no LaTeX delimiters are present", () => {
    expect(normalizeMathDelimiters("hello world")).toBe("hello world");
  });

  it("converts \\(...\\) to $...$", () => {
    expect(normalizeMathDelimiters("Inline \\(x^2\\) math")).toBe("Inline $x^2$ math");
  });

  it("converts \\[...\\] to $$...$$", () => {
    expect(normalizeMathDelimiters("Display \\[\\int_0^1 f(x)\\,dx\\]")).toBe("Display $$\\int_0^1 f(x)\\,dx$$");
  });

  it("does not touch delimiters inside code spans", () => {
    const input = "Here `\\(code\\)` and normal \\(math\\)";
    const result = normalizeMathDelimiters(input);
    expect(result).toContain("`\\(code\\)`");
    expect(result).toContain("$math$");
  });

  it("does not touch delimiters inside fenced code blocks", () => {
    const input = "```\n\\(not math\\)\n```\n\nBut \\(this is\\)";
    const result = normalizeMathDelimiters(input);
    expect(result).toContain("\\(not math\\)");
    expect(result).toContain("$this is$");
  });

  it("handles multiple math expressions", () => {
    expect(normalizeMathDelimiters("\\(a\\) and \\(b\\)")).toBe("$a$ and $b$");
  });

  it("handles mixed inline and display math", () => {
    const result = normalizeMathDelimiters("Inline \\(x\\) and display \\[\\sum x\\]");
    expect(result).toContain("$x$");
    expect(result).toContain("$$\\sum x$$");
  });

  // A formula opened one way and closed the other. Left alone, the opening $$ never
  // closes: remark-math swallows the equation and every later $…$ in the message
  // pairs up wrongly, so one malformed formula takes the whole answer down.
  describe("delimiters the model mixed up", () => {
    it("closes $$ opened math that ends with \\]", () => {
      expect(normalizeMathDelimiters("$$e^{i\\pi} + 1 = 0\\]")).toBe("$$e^{i\\pi} + 1 = 0$$");
    });

    it("closes \\[ opened math that ends with $$", () => {
      expect(normalizeMathDelimiters("\\[e^{i\\pi} + 1 = 0$$")).toBe("$$e^{i\\pi} + 1 = 0$$");
    });

    it("closes $ opened math that ends with \\)", () => {
      expect(normalizeMathDelimiters("valeur $x\\) ici")).toBe("valeur $x$ ici");
    });

    it("closes \\( opened math that ends with $", () => {
      expect(normalizeMathDelimiters("valeur \\(x$ ici")).toBe("valeur $x$ ici");
    });

    it("rescues the rest of the message, not just the broken formula", () => {
      const result = normalizeMathDelimiters("$$e^{i\\pi} + 1 = 0\\]\n\nElle relie $e$ et $\\pi$.");
      expect(result).toContain("$$e^{i\\pi} + 1 = 0$$");
      expect(result).toContain("$e$ et $\\pi$");
    });

    it("leaves a lone dollar alone rather than swallowing the line", () => {
      // A price, and an unrelated \) further along: the $ must not claim it.
      expect(normalizeMathDelimiters("Ça coûte $5 et \\(x\\) suit")).toBe("Ça coûte $5 et $x$ suit");
    });

    it("does not pair across a paragraph break", () => {
      const text = "$$x\n\nplus loin \\] ailleurs";
      expect(normalizeMathDelimiters(text)).toBe(text);
    });

    it("still leaves mixed delimiters inside a fenced block alone", () => {
      const text = "```latex\n$$e^{i\\pi} + 1 = 0\\]\n```";
      expect(normalizeMathDelimiters(text)).toBe(text);
    });
  });
});
