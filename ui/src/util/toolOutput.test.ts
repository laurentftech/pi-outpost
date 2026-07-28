import { describe, it, expect } from "vitest";
import { getFormattedToolOutput } from "./toolOutput";

describe("getFormattedToolOutput", () => {
  it("returns undefined for non-JSON content", () => {
    expect(getFormattedToolOutput("plain text output")).toBeUndefined();
  });

  it("renderes __pi_render envelope", () => {
    const result = getFormattedToolOutput(JSON.stringify({ __pi_render: { text: "Rendered content" } }));
    expect(result).toBe("Rendered content");
  });

  it("formats an object with task and title", () => {
    const result = getFormattedToolOutput(JSON.stringify({ task: "Refactor", title: "Extract Module", summary: "Moved code" }));
    expect(result).toContain("**Refactor**");
    expect(result).toContain("**Extract Module**");
    expect(result).toContain("Moved code");
  });

  it("formats relevantFiles", () => {
    const result = getFormattedToolOutput(JSON.stringify({ relevantFiles: ["a.ts", "b.ts", "c.ts"] }));
    expect(result).toContain("Relevant files:");
    expect(result).toContain("- a.ts");
    expect(result).toContain("- b.ts");
  });

  it("limits relevantFiles to 5 entries", () => {
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
    const result = getFormattedToolOutput(JSON.stringify({ relevantFiles: files }));
    const matches = result!.match(/- file/g);
    expect(matches).toHaveLength(5);
  });

  it("formats relevantFunctions with name and filePath", () => {
    const result = getFormattedToolOutput(JSON.stringify({
      relevantFunctions: [{ name: "foo", filePath: "a.ts" }, { name: "bar", filePath: "b.ts" }],
    }));
    expect(result).toContain("foo (a.ts)");
    expect(result).toContain("bar (b.ts)");
  });

  it("formats nextSteps", () => {
    const result = getFormattedToolOutput(JSON.stringify({ nextSteps: ["Step 1", "Step 2"] }));
    expect(result).toContain("Next steps:");
    expect(result).toContain("- Step 1");
  });

  it("returns undefined for pure JSON with no formatted fields", () => {
    const result = getFormattedToolOutput(JSON.stringify({ raw: "data", value: 42 }));
    expect(result).toBeUndefined();
  });

  it("handles truncated JSON output", () => {
    const base = JSON.stringify({ task: "Analysis", searchMode: "deep", relevantFiles: ["a.ts", "b.ts"] });
    const truncated = base + "\n… [truncated, 1234 more chars]";
    const result = getFormattedToolOutput(truncated);
    expect(result).toContain("**Analysis**");
    expect(result).toContain("deep");
    expect(result).toContain("a.ts");
  });

  it("returns undefined for empty output", () => {
    expect(getFormattedToolOutput("")).toBeUndefined();
  });
});
