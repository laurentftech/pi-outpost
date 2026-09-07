/**
 * Formatted runs of text, rendered as markdown.
 *
 * Shared rather than copied, for the reason `markdownTable.ts` gives about its
 * escaper: both document readers arrive at the same problem from opposite ends. A
 * .docx states that a run is struck through and the reader has to decide where
 * the markers go; a PDF states only that ink landed across some glyphs and the
 * reader infers the same thing. What they agree on is the output, and the two
 * rules below are what make that output parse.
 */

/**
 * The formatting that survives into markdown, as a bitmask.
 *
 * Underline is deliberately absent: GFM has no underline, and promoting an
 * underlined line to a heading would invent structure no document declared.
 */
export const STRIKE = 1;
export const BOLD = 2;
export const ITALIC = 4;

/** A run of text and the formatting it was written with. */
export interface Span {
  text: string;
  format: number;
}

/** Markers, outermost first, so combined formatting nests the same way every time. */
export function wrapSpan(text: string, format: number): string {
  let out = text;
  if ((format & ITALIC) !== 0) out = `*${out}*`;
  if ((format & BOLD) !== 0) out = `**${out}**`;
  if ((format & STRIKE) !== 0) out = `~~${out}~~`;
  return out;
}

/**
 * Spans as markdown.
 *
 * Two rules do the work, and both exist because a document splits its runs where
 * it likes rather than where the meaning is — Word at every formatting, language
 * and spell-check boundary, a PDF wherever the producer ended a string.
 *
 * Adjacent spans with the same formatting merge *first*: a sentence written as
 * five struck runs must come out as one `~~…~~` span, not five, because
 * `~~a~~~~b~~` is not a struck sentence to any renderer.
 *
 * Whitespace moves outside the markers *after* that merge, because a marker with
 * a space against it (`~~text ~~`) does not parse at all. Doing it before would
 * split the very spans the merge exists to join.
 */
export function renderSpans(spans: Span[]): string {
  const merged: Span[] = [];
  for (const span of spans) {
    if (span.text === "") continue;
    const last = merged[merged.length - 1];
    if (last !== undefined && last.format === span.format) last.text += span.text;
    else merged.push({ text: span.text, format: span.format });
  }

  return merged
    .map((span) => {
      if (span.format === 0) return span.text;
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(span.text);
      // A span with nothing visible in it — Word writes empty and whitespace-only
      // runs freely — contributes its whitespace and no markers.
      if (match === null || match[2] === "") return span.text;
      return match[1] + wrapSpan(match[2], span.format) + match[3];
    })
    .join("");
}

/**
 * How many struck spans a rendered document holds.
 *
 * Counted from the rendered markdown rather than tracked through the readers:
 * both of them assemble their output from independent pieces, and the thing worth
 * announcing is what the caller will actually see.
 */
export function countStruckSpans(markdown: string): number {
  return Math.floor((markdown.match(/~~/g)?.length ?? 0) / 2);
}

/**
 * The line that tells a reader the document has crossed something out, or "" when
 * it has not.
 *
 * It leads the extraction rather than trailing it, which is where every other
 * note in these readers sits. That is deliberate and was learned the hard way: a
 * model asked to transcribe a document read the markers, transcribed the text
 * without them, and only reported the strikethrough when asked directly
 * afterwards. A note at the end arrives after the answer has been written.
 */
export function struckThroughNotice(markdown: string): string {
  const count = countStruckSpans(markdown);
  if (count === 0) return "";
  return (
    `> This document crosses out ${count} passage${count === 1 ? "" : "s"}, marked \`~~like this~~\` below. ` +
    `The document has withdrawn them: report what is struck out when you transcribe, quote or summarise it, ` +
    `and do not present it as current.`
  );
}
