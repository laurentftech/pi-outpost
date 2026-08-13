import {
  extensionHtmlPresentation,
  fileEditPresentation,
  fileWritePresentation,
  orientSummaryPresentation,
  rawPresentation,
  renderEnvelopePresentation,
} from "./builtin";
import { gitDiffPresentation } from "./GitDiffView";
import { codeSearchPresentation } from "./CodeSearchView";
import type { Presentation, ToolItem } from "./types";

/**
 * The ordered table from design.md. First match wins, so order is the priority:
 * an extension's own rendering outranks a built-in one, a specific tool identity
 * outranks a shape guess, and the last entry matches unconditionally so selection
 * is total.
 */
export const PRESENTATIONS: readonly Presentation[] = [
  extensionHtmlPresentation,
  fileEditPresentation,
  fileWritePresentation,
  gitDiffPresentation,
  codeSearchPresentation,
  renderEnvelopePresentation,
  orientSummaryPresentation,
  rawPresentation,
];

function firstMatch(item: ToolItem): Presentation {
  for (const presentation of PRESENTATIONS) {
    let matched = false;
    try {
      matched = presentation.match(item);
    } catch {
      // A matcher that throws on a malformed result declines it; it never breaks
      // the card, and the error stays out of the conversation.
      matched = false;
    }
    if (matched) return presentation;
  }
  // Unreachable: the last entry matches unconditionally. Kept so the signature is
  // total by construction rather than by convention.
  return rawPresentation;
}

/**
 * Chooses the presentation for a tool call.
 *
 * `previousId` is the presentation already on screen, if any. A specialized
 * choice made while the call was running is not revoked when its output lands —
 * otherwise the card would swap renderer under the reader (design.md, decision 2).
 * Two things may still override it: an extension's own rendering, which outranks
 * a built-in guess, and any entry replacing the raw fallback, which is a widening.
 */
export function selectPresentation(item: ToolItem, previousId?: string): Presentation {
  const next = firstMatch(item);
  if (previousId === undefined || previousId === next.id) return next;

  const previous = PRESENTATIONS.find((p) => p.id === previousId);
  if (previous === undefined || previous.id === rawPresentation.id) return next;
  if (next.extensionOwned === true) return next;

  // Keep the established choice while it still applies.
  let stillMatches = false;
  try {
    stillMatches = previous.match(item);
  } catch {
    stillMatches = false;
  }
  return stillMatches ? previous : next;
}
