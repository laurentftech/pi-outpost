/**
 * Formats the openlore `orient()` payload as readable markdown.
 *
 * This is deliberately vendor-shaped: the field list below is one tool family's
 * response, not a general convention. It lives here, behind a named match in the
 * registry, rather than inside a generically-named utility where it silently
 * claimed every JSON result carrying a `title` or `summary` key.
 */

const LIST_CAP = 5;

interface FunctionRef {
  name?: unknown;
  filePath?: unknown;
  file?: unknown;
}

function describeFunction(entry: unknown): string {
  if (entry !== null && typeof entry === "object" && (entry as FunctionRef).name) {
    const ref = entry as FunctionRef;
    return `- ${String(ref.name)} (${String(ref.filePath ?? ref.file ?? "unknown")})`;
  }
  return `- ${String(entry)}`;
}

function pushList(lines: string[], heading: string, value: unknown, format: (entry: unknown) => string) {
  if (!Array.isArray(value) || value.length === 0) return;
  lines.push(`\n${heading}`);
  for (const entry of value.slice(0, LIST_CAP)) lines.push(format(entry));
}

/**
 * Returns the markdown summary for a parsed tool result, or `undefined` when the
 * result carries none of the recognized fields — which is the signal that this
 * presentation does not apply.
 */
export function formatOrientSummary(parsed: unknown): string | undefined {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const lines: string[] = [];

  if (record.task) lines.push(`**${String(record.task)}**`);
  if (record.searchMode) lines.push(`Mode: ${String(record.searchMode)}`);
  if (record.title) lines.push(`**${String(record.title)}**`);
  if (record.summary) lines.push(String(record.summary));
  pushList(lines, "Relevant files:", record.relevantFiles, (f) => `- ${String(f)}`);
  pushList(lines, "Relevant functions:", record.relevantFunctions, describeFunction);
  pushList(lines, "Next steps:", record.nextSteps, (s) => `- ${String(s)}`);
  pushList(lines, "Next steps:", record.nextStepsText, (s) => `- ${String(s)}`);

  const summary = lines.join("\n").trim();
  return summary === "" ? undefined : summary;
}
