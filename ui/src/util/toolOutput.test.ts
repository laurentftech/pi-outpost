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

  it("returns a bare JSON string as-is", () => {
    expect(getFormattedToolOutput('"simple string"')).toBe("simple string");
  });
});

/**
 * The recovery paths: what happens when the tool's JSON never finished arriving.
 * These are the branches that decide between showing a partial summary and showing
 * nothing, and they are the ones a malformed payload actually reaches.
 */
describe("getFormattedToolOutput — partial and unusual payloads", () => {
  it("formats the search mode and the summary", () => {
    const output = JSON.stringify({ searchMode: "semantic", summary: "Four call sites." });
    expect(getFormattedToolOutput(output)).toBe("Mode: semantic\nFour call sites.");
  });

  it("formats nextStepsText the same way as nextSteps", () => {
    const output = JSON.stringify({ title: "Orient", nextStepsText: ["read the spec", "run the tests"] });
    expect(getFormattedToolOutput(output)).toContain("- read the spec");
  });

  it("caps the long lists at five entries", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"];
    const output = JSON.stringify({ title: "T", nextSteps: many, relevantFunctions: many.map((name) => ({ name })) });
    const formatted = getFormattedToolOutput(output) ?? "";
    expect(formatted).toContain("- e");
    expect(formatted).not.toContain("- f");
  });

  it("names a function whose file is reported under `file` rather than `filePath`", () => {
    const output = JSON.stringify({ relevantFunctions: [{ name: "runGit", file: "server/src/git.ts" }] });
    expect(getFormattedToolOutput(output)).toContain("- runGit (server/src/git.ts)");
  });

  it("says the file is unknown rather than printing undefined", () => {
    const output = JSON.stringify({ relevantFunctions: [{ name: "runGit" }] });
    expect(getFormattedToolOutput(output)).toContain("- runGit (unknown)");
  });

  it("falls back to the raw value for a function that is not an object", () => {
    const output = JSON.stringify({ relevantFunctions: ["runGit"] });
    expect(getFormattedToolOutput(output)).toContain("- runGit");
  });

  it("recovers a complete object followed by trailing rubbish", () => {
    // A tool that appended a log line after its JSON: the object is intact, so the
    // summary should still be shown rather than dropped for the trailing bytes
    const output = `${JSON.stringify({ title: "Orient", summary: "Two hits." })}\nwarning: cache stale`;
    expect(getFormattedToolOutput(output)).toBe("**Orient**\nTwo hits.");
  });

  it("shows nothing rather than a guess when the outer object never closed", () => {
    // The brace-counting recovery needs a closing brace for the outermost object.
    // A payload cut off before that has no prefix that parses, so there is nothing
    // honest to show — better empty than a summary invented from half a field.
    const output = '{"title":"Orient","summary":"Two hits.","relevantFiles":["a.ts","b.t';
    expect(getFormattedToolOutput(output)).toBeUndefined();
  });

  it("recovers the object when the truncation landed after it closed", () => {
    const output = '{"title":"Orient","summary":"Two hits."} trailing bytes {"partial":';
    expect(getFormattedToolOutput(output)).toContain("Two hits.");
  });

  it("gives up rather than guessing when nothing parses", () => {
    expect(getFormattedToolOutput('{"title": "Orient"')).toBeUndefined();
    expect(getFormattedToolOutput("{{{{")).toBeUndefined();
    expect(getFormattedToolOutput("plain text output")).toBeUndefined();
  });

  it("returns nothing for a JSON value that is not an object or string", () => {
    expect(getFormattedToolOutput("42")).toBeUndefined();
    expect(getFormattedToolOutput("null")).toBeUndefined();
    expect(getFormattedToolOutput("true")).toBeUndefined();
  });

  it("prefers the render envelope over the fields beside it", () => {
    const output = JSON.stringify({ __pi_render: { text: "rendered" }, title: "ignored" });
    expect(getFormattedToolOutput(output)).toBe("rendered");
  });
});
