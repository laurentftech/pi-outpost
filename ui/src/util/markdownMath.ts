/**
 * remark-math only recognizes $…$ / $$…$$, but models (Mistral in particular)
 * routinely emit LaTeX with \(…\) / \[…\] delimiters, which then render as raw
 * text. Rewrite those to dollar delimiters — outside code spans and fences only,
 * so LaTeX examples inside code blocks stay untouched.
 */
export function normalizeMathDelimiters(text: string): string {
  if (!text.includes("\\(") && !text.includes("\\[")) return text;
  // Odd segments are code (fenced blocks or inline spans) — left as-is
  const segments = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  return segments
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : segment
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => `$$${math}$$`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$${math}$`),
    )
    .join("");
}
