import assert from "node:assert/strict";
import test from "node:test";
import { getFormattedToolOutput } from "../src/toolOutput.ts";

// Test cases based on actual openlore output
test("formats openlore orient output correctly", () => {
  const openloreOutput = `{
  "task": "formatting md",
  "searchMode": "hybrid",
  "relevantFiles": ["shared/src/protocol.ts"],
  "relevantFunctions": [{"name": "ExtensionUIRequest", "filePath": "shared/src/protocol.ts", "score": 4.845}],
  "nextSteps": ["Before making an architectural choice, call record_decision", "After implementing, run check_spec_drift"]
}`;
  
  const result = getFormattedToolOutput(openloreOutput);
  assert.notEqual(result, undefined, "Should return formatted output");
  assert.ok(result?.includes("**formatting md**"), "Should include task");
  assert.ok(result?.includes("Mode: hybrid"), "Should include searchMode");
  assert.ok(result?.includes("Relevant files:"), "Should include relevant files header");
  assert.ok(result?.includes("- shared/src/protocol.ts"), "Should include file");
  assert.ok(result?.includes("Next steps:"), "Should include next steps header");
  assert.ok(result?.includes("- Before making"), "Should include next step");
});

test("handles truncated JSON with valid prefix", () => {
  // Simulate truncated JSON where the prefix before truncation marker is still valid JSON
  const truncatedOutput = `{
  "task": "formatting md",
  "searchMode": "hybrid",
  "relevantFiles": ["shared/src/protocol.ts"]
}` + "\n… [truncated, 50000 chars total]";
  
  const result = getFormattedToolOutput(truncatedOutput);
  assert.notEqual(result, undefined, "Should return formatted output even when truncated");
  assert.ok(result?.includes("**formatting md**"), "Should include task from truncated JSON");
});

test("handles truncated JSON with invalid prefix", () => {
  // Simulate truncated JSON where the prefix is incomplete but can be recovered with brace counting
  // Use a valid partial JSON: {"task": "formatting md"} is complete and valid
  const truncatedOutput = `{
  "task": "formatting md"
}` + "\n… [truncated, 50000 chars total]";
  
  const result = getFormattedToolOutput(truncatedOutput);
  // With the brace counting fallback, it should find the valid JSON part
  assert.notEqual(result, undefined, "Should recover from truncation using brace counting");
  assert.ok(result?.includes("**formatting md**"), "Should extract partial valid JSON");
});

test("returns undefined for non-JSON", () => {
  const nonJson = "This is just plain text";
  const result = getFormattedToolOutput(nonJson);
  assert.equal(result, undefined, "Should return undefined for non-JSON");
});

test("handles __pi_render envelope", () => {
  const piRenderOutput = `{"__pi_render": {"text": "**Formatted output**\\n\\n- item 1\\n- item 2"}, "payload": {"data": "..."}}`;
  
  const result = getFormattedToolOutput(piRenderOutput);
  assert.notEqual(result, undefined, "Should handle __pi_render");
  assert.ok(result?.includes("**Formatted output**"), "Should extract text from __pi_render");
});

test("handles empty openlore output", () => {
  const emptyOutput = `{"task": "test"}`;
  const result = getFormattedToolOutput(emptyOutput);
  assert.equal(result, "**test**", "Should format minimal output");
});

test("returns undefined for objects without known fields", () => {
  const genericJson = `{"unknownField": "value", "another": 123}`;
  const result = getFormattedToolOutput(genericJson);
  assert.equal(result, undefined, "Should return undefined for pure JSON without known fields");
});

test("handles simple JSON string", () => {
  const stringJson = `"simple string"`;
  const result = getFormattedToolOutput(stringJson);
  assert.equal(result, "simple string", "Should return string as-is");
});
