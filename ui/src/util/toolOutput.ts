/**
 * Parse a tool result that is meant to be JSON but may not have finished arriving.
 *
 * Strips the truncation suffix the server appends, then falls back to
 * brace-counting so an object followed by trailing bytes still parses. Returns
 * `undefined` when nothing honest can be recovered — a half-parsed object is
 * never returned as if it were complete.
 *
 * Exported so presentations parse a tool result the same way instead of each
 * re-implementing the recovery.
 */
export function parseLooseJson(output: string): unknown {
  const truncationMarker = "\n… [truncated,";
  const jsonToParse = output.includes(truncationMarker)
    ? output.split(truncationMarker)[0]
    : output;

  try {
    return JSON.parse(jsonToParse);
  } catch {
    // Not valid on its own — try to recover a complete object from the front.
  }

  let braceCount = 0;
  let lastCompleteIndex = -1;
  let lastClosingIndex = -1;
  for (let i = 0; i < jsonToParse.length; i++) {
    if (jsonToParse[i] === "{") braceCount++;
    if (jsonToParse[i] === "}") {
      braceCount--;
      lastClosingIndex = i;
      if (braceCount === 0) {
        lastCompleteIndex = i;
        break;
      }
    }
  }

  // The outermost object closed: everything after it is trailing noise.
  if (lastCompleteIndex > 0) {
    try {
      return JSON.parse(jsonToParse.slice(0, lastCompleteIndex + 1));
    } catch {
      return undefined;
    }
  }

  // The outermost object never closed. A nested one might still stand alone.
  if (lastClosingIndex > 0) {
    try {
      return JSON.parse(jsonToParse.slice(0, lastClosingIndex + 1));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * The user-facing text a tool declared for itself, via the authoritative
 * `__pi_render` envelope. A bare JSON string is already display text and is
 * returned as-is.
 *
 * Returns `undefined` for anything else, including a JSON object with no
 * envelope — formatting a particular tool vendor's payload is a presentation's
 * job, not this utility's.
 */
export function getFormattedToolOutput(output: string): string | undefined {
  const parsed = parseLooseJson(output);
  if (typeof parsed === "string") return parsed;
  if (parsed === null || typeof parsed !== "object") return undefined;
  const envelope = (parsed as { __pi_render?: { text?: unknown } }).__pi_render;
  if (envelope?.text === undefined || envelope.text === null) return undefined;
  return String(envelope.text);
}
