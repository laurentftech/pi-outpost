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
});
