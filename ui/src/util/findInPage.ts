/**
 * Find-in-page: locating a query in plain text, and marking it up wherever it is
 * shown as real DOM text — rendered code, Markdown, or a PDF page's text layer.
 *
 * One algorithm serves all three, because none of them need to know about each
 * other: given a container element, walk its text nodes, find the query in their
 * concatenated text, and wrap each match in its own `<mark>` — one `<mark>` per
 * underlying text node a match touches, rather than one spanning several, so
 * `Range.surroundContents` never has to reason about partially-selected elements
 * (a syntax-highlighting `<span>`, a PDF text-layer run) sitting between them.
 */

/** A generous but finite limit: unbounded matches on a pathological query (a
 * single common character) would mean thousands of `<mark>` elements, which
 * costs layout time for no reading benefit. The count keeps counting past it;
 * only marking (and therefore navigation) stops. */
export const MAX_HIGHLIGHTED_MATCHES = 3000;

/** A match found in plain text, before any DOM is touched. */
export interface TextMatch {
  start: number;
  end: number;
}

/** One logical match, as marked up in the DOM — one or more `<mark>` elements
 * because a match can span more than one underlying text node. */
export interface DomMatch {
  marks: HTMLElement[];
}

export interface HighlightResult {
  /** In document order. */
  matches: DomMatch[];
  /** True when more matches exist than were marked (see MAX_HIGHLIGHTED_MATCHES). */
  truncated: boolean;
  /** Restores the container's original text nodes. Idempotent. */
  clear: () => void;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every case-insensitive occurrence of `query` in `text`, plain substring — no regex features. */
export function findMatchesInText(text: string, query: string, cap = Infinity): TextMatch[] {
  if (query === "") return [];
  const regex = new RegExp(escapeRegExp(query), "gi");
  const matches: TextMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= cap) break;
  }
  return matches;
}

interface NodeSpan {
  node: Text;
  start: number;
  end: number;
}

/** Every non-empty text node under `container`, in document order, alongside its
 * offset into their concatenation — the coordinate space `findMatchesInText` searches. */
function collectTextNodes(container: HTMLElement): { nodes: NodeSpan[]; text: string } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: NodeSpan[] = [];
  let text = "";
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (length === 0) continue;
    nodes.push({ node, start: text.length, end: text.length + length });
    text += node.data;
  }
  return { nodes, text };
}

/**
 * Marks every occurrence of `query` under `container`.
 *
 * Matches are wrapped in reverse document order: splitting a text node for a
 * later match only ever trims its tail, which never invalidates the offsets an
 * earlier match (lower down the loop, further from the end) still needs to find
 * its own place inside that same node.
 */
export function highlightMatches(container: HTMLElement, query: string, cap = MAX_HIGHLIGHTED_MATCHES): HighlightResult {
  const noop: HighlightResult = { matches: [], truncated: false, clear: () => {} };
  if (query === "") return noop;

  const { nodes, text } = collectTextNodes(container);
  if (text === "") return noop;

  const found = findMatchesInText(text, query, cap + 1);
  const truncated = found.length > cap;
  const ranges = truncated ? found.slice(0, cap) : found;
  if (ranges.length === 0) return { matches: [], truncated, clear: () => {} };

  const matches: DomMatch[] = new Array(ranges.length);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { start, end } = ranges[i];
    const marks: HTMLElement[] = [];
    for (const span of nodes) {
      if (span.end <= start || span.start >= end) continue;
      const localStart = Math.max(0, start - span.start);
      const localEnd = Math.min(span.node.data.length, end - span.start);
      if (localStart >= localEnd) continue;

      let target = span.node;
      if (localEnd < target.data.length) target.splitText(localEnd);
      const middle = localStart > 0 ? target.splitText(localStart) : target;

      const mark = document.createElement("mark");
      mark.className = "find-match";
      middle.replaceWith(mark);
      mark.appendChild(middle);
      marks.push(mark);
    }
    matches[i] = { marks };
  }

  return {
    matches,
    truncated,
    clear: () => {
      for (const { marks } of matches) {
        for (const mark of marks) {
          mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
        }
      }
      container.normalize();
    },
  };
}
