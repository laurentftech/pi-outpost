/** Extract formatted user-facing text from tool output.
 * Checks for authoritative __pi_render envelope first, otherwise returns undefined.
 * For openlore tools, also formats known fields as readable markdown.
 * Handles truncated JSON by stripping the truncation suffix before parsing.
 * Falls back to brace-counting recovery for mid-truncation cases.
 * Returns undefined only for non-JSON or completely unparseable content.
 */
export function getFormattedToolOutput(output: string): string | undefined {
  // Try to parse as JSON - handle truncated output by stripping the truncation suffix
  let jsonToParse = output;
  const truncationMarker = "\n… [truncated,";
  if (output.includes(truncationMarker)) {
    jsonToParse = output.split(truncationMarker)[0];
  }

  // Helper to format a parsed JSON object
  const formatParsedObject = (parsed: Record<string, unknown>): string | undefined => {
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

    // No formatted output for pure JSON - return undefined to show nothing in collapsed state
    return undefined;
  };

  // First, try to parse as valid JSON
  try {
    const parsed = JSON.parse(jsonToParse);
    if (parsed && typeof parsed === "object") {
      // Check for authoritative __pi_render envelope first
      if (parsed.__pi_render?.text) {
        return String(parsed.__pi_render.text);
      }

      return formatParsedObject(parsed as Record<string, unknown>);
    }
    // If parsed is a string, return it as-is (could be already formatted markdown)
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // Not JSON or parse error - try to fix truncated JSON by finding the last valid closing brace
  }

  // Try brace-counting recovery: find a valid JSON substring by counting braces
  // First pass: look for a complete object (braceCount === 0)
  try {
    let braceCount = 0;
    let lastCompleteIndex = -1;
    let lastClosingIndex = -1;

    for (let i = 0; i < jsonToParse.length; i++) {
      if (jsonToParse[i] === "{") braceCount++;
      if (jsonToParse[i] === "}") {
        braceCount--;
        lastClosingIndex = i; // Track the last closing brace we see
        if (braceCount === 0) {
          lastCompleteIndex = i;
          break; // Found the matching closing brace for the outermost object
        }
      }
    }

    // First, try the complete object if found
    if (lastCompleteIndex > 0) {
      const validJson = jsonToParse.slice(0, lastCompleteIndex + 1);
      const parsed = JSON.parse(validJson);
      if (parsed && typeof parsed === "object") {
        return formatParsedObject(parsed as Record<string, unknown>);
      }
    }

    // If no complete object found, try using the last closing brace we saw
    // This handles cases where JSON is truncated mid-object
    if (lastClosingIndex > 0 && lastCompleteIndex === -1) {
      const validJson = jsonToParse.slice(0, lastClosingIndex + 1);
      try {
        const parsed = JSON.parse(validJson);
        if (parsed && typeof parsed === "object") {
          return formatParsedObject(parsed as Record<string, unknown>);
        }
      } catch {
        // Still can't parse this fragment
      }
    }
  } catch {
    // Still can't parse
  }

  return undefined;
}
