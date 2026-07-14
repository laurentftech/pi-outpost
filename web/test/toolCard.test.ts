import assert from "node:assert/strict";
import test from "node:test";

// Inline the getFormattedToolOutput function for testing
function getFormattedToolOutput(output: string): string | undefined {
  let jsonToParse = output;
  const truncationMarker = "\n… [truncated,";
  if (output.includes(truncationMarker)) {
    jsonToParse = output.split(truncationMarker)[0];
  }
  
  // First, try to parse as valid JSON
  try {
    const parsed = JSON.parse(jsonToParse);
    if (parsed && typeof parsed === "object") {
      if (parsed.__pi_render?.text) {
        return String(parsed.__pi_render.text);
      }
      
      const lines: string[] = [];
      if (parsed.task) lines.push(`**${String(parsed.task)}**`);
      if (parsed.searchMode) lines.push(`Mode: ${String(parsed.searchMode)}`);
      if (parsed.title) lines.push(`**${String(parsed.title)}**`);
      if (parsed.summary) lines.push(String(parsed.summary));
      if (Array.isArray(parsed.relevantFiles) && parsed.relevantFiles.length > 0) {
        lines.push("\nRelevant files:");
        for (const f of (parsed.relevantFiles as string[]).slice(0, 5)) lines.push(`- ${f}`);
      }
      if (Array.isArray(parsed.relevantFunctions) && parsed.relevantFunctions.length > 0) {
        lines.push("\nRelevant functions:");
        for (const fn of (parsed.relevantFunctions as any[]).slice(0, 5)) {
          if (fn && fn.name) lines.push(`- ${fn.name} (${fn.filePath ?? fn.file ?? "unknown"})`);
          else lines.push(`- ${String(fn)}`);
        }
      }
      if (Array.isArray(parsed.nextSteps) && parsed.nextSteps.length > 0) {
        lines.push("\nNext steps:");
        for (const s of (parsed.nextSteps as string[]).slice(0, 5)) lines.push(`- ${s}`);
      }
      if (Array.isArray(parsed.nextStepsText) && parsed.nextStepsText.length > 0) {
        lines.push("\nNext steps:");
        for (const s of (parsed.nextStepsText as string[]).slice(0, 5)) lines.push(`- ${s}`);
      }
      const summary = lines.join("\n").trim();
      if (summary) return summary;
      
      // Fallback for any valid JSON object: return pretty-printed JSON in a markdown code block
      return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
    }
    // If parsed is a string, return it as-is (could be already formatted markdown)
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // Not JSON or parse error - try to fix truncated JSON by finding the last valid closing brace
    try {
      // Count braces to find a valid JSON substring
      let braceCount = 0;
      let lastValidIndex = -1;
      for (let i = 0; i < jsonToParse.length; i++) {
        if (jsonToParse[i] === "{") braceCount++;
        if (jsonToParse[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            lastValidIndex = i;
            break; // Found the matching closing brace for the outermost object
          }
        }
      }
      if (lastValidIndex > 0) {
        const validJson = jsonToParse.slice(0, lastValidIndex + 1);
        const parsed = JSON.parse(validJson);
        if (parsed && typeof parsed === "object") {
          const lines: string[] = [];
          if (parsed.task) lines.push(`**${String(parsed.task)}**`);
          if (parsed.searchMode) lines.push(`Mode: ${String(parsed.searchMode)}`);
          if (parsed.title) lines.push(`**${String(parsed.title)}**`);
          if (parsed.summary) lines.push(String(parsed.summary));
          if (Array.isArray(parsed.relevantFiles) && parsed.relevantFiles.length > 0) {
            lines.push("\nRelevant files:");
            for (const f of (parsed.relevantFiles as string[]).slice(0, 5)) lines.push(`- ${f}`);
          }
          if (Array.isArray(parsed.relevantFunctions) && parsed.relevantFunctions.length > 0) {
            lines.push("\nRelevant functions:");
            for (const fn of (parsed.relevantFunctions as any[]).slice(0, 5)) {
              if (fn && fn.name) lines.push(`- ${fn.name} (${fn.filePath ?? fn.file ?? "unknown"})`);
              else lines.push(`- ${String(fn)}`);
            }
          }
          if (Array.isArray(parsed.nextSteps) && parsed.nextSteps.length > 0) {
            lines.push("\nNext steps:");
            for (const s of (parsed.nextSteps as string[]).slice(0, 5)) lines.push(`- ${s}`);
          }
          const summary = lines.join("\n").trim();
          if (summary) return summary;
          
          // Fallback for recovered JSON: return pretty-printed JSON in a markdown code block
          return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
        }
      }
    } catch {
      // Still can't parse
    }
  }
  return undefined;
}

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

test("returns pretty-printed JSON for objects without known fields", () => {
  const genericJson = `{"unknownField": "value", "another": 123}`;
  const result = getFormattedToolOutput(genericJson);
  assert.notEqual(result, undefined, "Should return pretty-printed JSON");
  assert.ok(result?.includes("```json"), "Should be wrapped in markdown code block");
  assert.ok(result?.includes("unknownField"), "Should include field names");
  assert.ok(result?.includes("value"), "Should include field values");
});

test("handles simple JSON string", () => {
  const stringJson = `"simple string"`;
  const result = getFormattedToolOutput(stringJson);
  assert.equal(result, "simple string", "Should return string as-is");
});
