import { describe, it, expect } from "vitest";
import { formatOrientSummary } from "./orientSummary";
import { parseLooseJson } from "../util/toolOutput";

/** These cases moved here from `toolOutput.test.ts` with the formatting itself. */
function format(output: string): string | undefined {
  return formatOrientSummary(parseLooseJson(output));
}

describe("formatOrientSummary", () => {
  it("formats an object with task and title", () => {
    const result = format(JSON.stringify({ task: "Refactor", title: "Extract Module", summary: "Moved code" }));
    expect(result).toContain("**Refactor**");
    expect(result).toContain("**Extract Module**");
    expect(result).toContain("Moved code");
  });

  it("formats the search mode and the summary", () => {
    expect(format(JSON.stringify({ searchMode: "semantic", summary: "Four call sites." }))).toBe(
      "Mode: semantic\nFour call sites.",
    );
  });

  it("formats relevantFiles", () => {
    const result = format(JSON.stringify({ relevantFiles: ["a.ts", "b.ts", "c.ts"] }));
    expect(result).toContain("Relevant files:");
    expect(result).toContain("- a.ts");
    expect(result).toContain("- b.ts");
  });

  it("limits relevantFiles to 5 entries", () => {
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
    const result = format(JSON.stringify({ relevantFiles: files }));
    expect(result!.match(/- file/g)).toHaveLength(5);
  });

  it("formats relevantFunctions with name and filePath", () => {
    const result = format(
      JSON.stringify({ relevantFunctions: [{ name: "foo", filePath: "a.ts" }, { name: "bar", filePath: "b.ts" }] }),
    );
    expect(result).toContain("foo (a.ts)");
    expect(result).toContain("bar (b.ts)");
  });

  it("formats nextSteps", () => {
    const result = format(JSON.stringify({ nextSteps: ["Step 1", "Step 2"] }));
    expect(result).toContain("Next steps:");
    expect(result).toContain("- Step 1");
  });

  it("formats nextStepsText the same way as nextSteps", () => {
    expect(format(JSON.stringify({ title: "Orient", nextStepsText: ["read the spec", "run the tests"] }))).toContain(
      "- read the spec",
    );
  });

  it("caps the long lists at five entries", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"];
    const output = JSON.stringify({ title: "T", nextSteps: many, relevantFunctions: many.map((name) => ({ name })) });
    const formatted = format(output) ?? "";
    expect(formatted).toContain("- e");
    expect(formatted).not.toContain("- f");
  });

  it("names a function whose file is reported under `file` rather than `filePath`", () => {
    expect(format(JSON.stringify({ relevantFunctions: [{ name: "runGit", file: "server/src/git.ts" }] }))).toContain(
      "- runGit (server/src/git.ts)",
    );
  });

  it("says the file is unknown rather than printing undefined", () => {
    expect(format(JSON.stringify({ relevantFunctions: [{ name: "runGit" }] }))).toContain("- runGit (unknown)");
  });

  it("falls back to the raw value for a function that is not an object", () => {
    expect(format(JSON.stringify({ relevantFunctions: ["runGit"] }))).toContain("- runGit");
  });

  it("formats a truncated payload from what survived", () => {
    const base = JSON.stringify({ task: "Analysis", searchMode: "deep", relevantFiles: ["a.ts", "b.ts"] });
    const result = format(`${base}\n… [truncated, 1234 more chars]`);
    expect(result).toContain("**Analysis**");
    expect(result).toContain("deep");
    expect(result).toContain("a.ts");
  });

  it("does not apply to an object with none of the recognized fields", () => {
    expect(format(JSON.stringify({ raw: "data", value: 42 }))).toBeUndefined();
  });

  it("does not apply to content that never parsed", () => {
    expect(format("plain text output")).toBeUndefined();
    expect(format("42")).toBeUndefined();
    expect(format('"a bare string"')).toBeUndefined();
  });
});
