import { describe, it, expect } from "vitest";
import { getFormattedToolOutput, parseLooseJson } from "./toolOutput";

describe("getFormattedToolOutput", () => {
  it("returns undefined for non-JSON content", () => {
    expect(getFormattedToolOutput("plain text output")).toBeUndefined();
  });

  it("renders the __pi_render envelope", () => {
    const result = getFormattedToolOutput(JSON.stringify({ __pi_render: { text: "Rendered content" } }));
    expect(result).toBe("Rendered content");
  });

  it("returns undefined for empty output", () => {
    expect(getFormattedToolOutput("")).toBeUndefined();
  });

  it("returns a bare JSON string as-is", () => {
    expect(getFormattedToolOutput('"simple string"')).toBe("simple string");
  });

  it("returns undefined for a JSON object carrying no envelope", () => {
    // Formatting a particular vendor's payload belongs to a presentation, not here
    expect(getFormattedToolOutput(JSON.stringify({ title: "Orient", summary: "Two hits." }))).toBeUndefined();
    expect(getFormattedToolOutput(JSON.stringify({ raw: "data", value: 42 }))).toBeUndefined();
  });

  it("returns nothing for a JSON value that is not an object or string", () => {
    expect(getFormattedToolOutput("42")).toBeUndefined();
    expect(getFormattedToolOutput("null")).toBeUndefined();
    expect(getFormattedToolOutput("true")).toBeUndefined();
  });

  it("reads the envelope out of a truncated payload", () => {
    const base = JSON.stringify({ __pi_render: { text: "Rendered content" } });
    expect(getFormattedToolOutput(`${base}\n… [truncated, 1234 more chars]`)).toBe("Rendered content");
  });
});

/**
 * The recovery paths: what happens when the tool's JSON never finished arriving.
 * These are the branches that decide between showing a partial summary and showing
 * nothing, and they are the ones a malformed payload actually reaches.
 */
describe("parseLooseJson", () => {
  it("parses a well-formed object", () => {
    expect(parseLooseJson('{"title":"Orient"}')).toEqual({ title: "Orient" });
  });

  it("strips the truncation suffix before parsing", () => {
    const base = JSON.stringify({ task: "Analysis", searchMode: "deep" });
    expect(parseLooseJson(`${base}\n… [truncated, 1234 more chars]`)).toEqual({
      task: "Analysis",
      searchMode: "deep",
    });
  });

  it("recovers a complete object followed by trailing rubbish", () => {
    // A tool that appended a log line after its JSON: the object is intact, so the
    // summary should still be shown rather than dropped for the trailing bytes
    const output = `${JSON.stringify({ title: "Orient", summary: "Two hits." })}\nwarning: cache stale`;
    expect(parseLooseJson(output)).toEqual({ title: "Orient", summary: "Two hits." });
  });

  it("recovers the object when the truncation landed after it closed", () => {
    const output = '{"title":"Orient","summary":"Two hits."} trailing bytes {"partial":';
    expect(parseLooseJson(output)).toEqual({ title: "Orient", summary: "Two hits." });
  });

  it("gives up rather than guessing when the outer object never closed", () => {
    // The brace-counting recovery needs a closing brace for the outermost object.
    // A payload cut off before that has no prefix that parses, so there is nothing
    // honest to show — better empty than a summary invented from half a field.
    expect(parseLooseJson('{"title":"Orient","summary":"Two hits.","relevantFiles":["a.ts","b.t')).toBeUndefined();
  });

  it("gives up when a brace inside a string makes the count lie", () => {
    // Brace counting does not know about string literals: it sees the outer object
    // close early. The slice it hands to JSON.parse is invalid, and an invalid
    // slice yields nothing rather than a partial object.
    expect(parseLooseJson('{"pattern":"}"')).toBeUndefined();
  });

  it("gives up when only a nested object ever closed", () => {
    expect(parseLooseJson('{"a": {"b": 1}, "c": ')).toBeUndefined();
  });

  it("gives up rather than guessing when nothing parses", () => {
    expect(parseLooseJson('{"title": "Orient"')).toBeUndefined();
    expect(parseLooseJson("{{{{")).toBeUndefined();
    expect(parseLooseJson("plain text output")).toBeUndefined();
  });
});
